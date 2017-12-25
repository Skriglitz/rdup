'use strict';
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const minimatch = require('minimatch');
const crypto = require('crypto');
const Filesystem = require('./filesystem');
const disk = require('./disk');
const crawlFilesystem = require('./crawlfs');


// Return whether or not a directory should be excluded from packing due to
// "--exclude-dir" option
//
// @param {string} path - diretory path to check
// @param {string} pattern - literal prefix [for backward compatibility] or glob pattern
// @param {array} excludeDirs - Array of directory paths previously marked as excluded
//
const isDirExcluded = function (path, pattern, excludeDirs) {
    if (path.indexOf(pattern) === 0 || minimatch(path, pattern)) {
        if (excludeDirs.indexOf(path) === -1) {
            excludeDirs.push(path);
        }
        return true;
    }
    for (let i = 0; i < excludeDirs.length; i++) {
        if (path.indexOf(excludeDirs[i]) === 0) {
            return true;
        }
    }
    return false;

};

module.exports.createPackage = function (src, dest, callback) {
    return module.exports.createPackageWithOptions(src, dest, {}, callback);
};

module.exports.createPackageWithOptions = function (src, dest, options, callback) {
    const dot = typeof options.dot === 'undefined' ? true : options.dot;

    return crawlFilesystem(src, { dot: dot }, function (error, filenames, metadata) {
        if (error) {
            return callback(error);
        }
        module.exports.createPackageFromFiles(src, dest, filenames, metadata, options, callback);
    });
};

/*
createPackageFromFiles - Create an rdup-archive from a list of filenames
src: Base path. All files are relative to this.
dest: Archive filename (& path).
filenames: Array of filenames relative to src.
metadata: Object with filenames as keys and {type='directory|file|link', stat: fs.stat} as values. (Optional)
options: The options.
callback: The callback function. Accepts (err).
*/
module.exports.createPackageFromFiles = function (src, dest, filenames, metadata, options, callback) {
    if (typeof metadata === 'undefined' || metadata === null) {
        metadata = {};
    }
    const filesystem = new Filesystem(src);
    const files = [];
    const excludeDirs = [];

    let filenamesSorted = [];
    if (options.ordering) {
        const orderingFiles = fs.readFileSync(options.ordering).toString().split('\n').map(function (line) {
            if (line.indexOf(':')) {
                line = line.split(':').pop();
            }
            line = line.trim();
            if (line.indexOf('/') === 0) {
                line = line.slice(1);
            }
            return line;
        });

        const ordering = [];
        for (const file of orderingFiles) {
            const pathComponents = file.split(path.sep);
            let str = src;
            for (const pathComponent of pathComponents) {
                str = path.join(str, pathComponent);
                ordering.push(str);
            }
        }

        let missing = 0;
        const total = filenames.length;

        for (const file of ordering) {
            if (!filenamesSorted.indexOf(file) && filenames.includes(file)) {
                filenamesSorted.push(file);
            }
        }

        for (const file of filenames) {
            if (!filenamesSorted.indexOf(file)) {
                filenamesSorted.push(file);
                missing += 1;
            }
        }

        console.log(`Ordering file has ${((total - missing) / total) * 100}% coverage.`);
    } else {
        filenamesSorted = filenames;
    }

    const handleFile = function (filename, done) {
        let file = metadata[filename];
        let type;
        if (!file) {
            const stat = fs.lstatSync(filename);
            if (stat.isDirectory()) {
                type = 'directory';
            }
            if (stat.isFile()) {
                type = 'file';
            }
            if (stat.isSymbolicLink()) {
                type = 'link';
            }
            file = { stat, type };
        }

        let shouldExclude;
        switch (file.type) {
            case 'directory':
                shouldExclude = options.excludeDir
                    ? isDirExcluded(path.relative(src, filename), options.excludeDir, excludeDirs)
                    : false;
                filesystem.insertDirectory(filename, shouldExclude);
                break;
            case 'file':
                shouldExclude = false;
                if (options.exclude) {
                    shouldExclude = minimatch(filename, options.exclude, { matchBase: true });
                }
                if (!shouldExclude && options.excludeDir) {
                    const dirName = path.relative(src, path.dirname(filename));
                    shouldExclude = isDirExcluded(dirName, options.excludeDir, excludeDirs);
                }
                files.push({ filename: filename, excluded: shouldExclude, compress: options.compress });
                filesystem.insertFile(filename, shouldExclude, file, options, done);
                return;
            case 'link':
                filesystem.insertLink(filename);
                break;
        }
        return process.nextTick(done);
    };

    const insertsDone = function () {
        return mkdirp(path.dirname(dest), function (error) {
            if (error) {
                return callback(error);
            }
            return disk.writeFilesystem(dest, filesystem, files, metadata, function (error) {
                if (error) {
                    return callback(error);
                }
                return callback(null);
            });
        });
    };

    const names = filenamesSorted.slice();

    const next = function (name) {
        if (!name) {
            return insertsDone();
        }

        return handleFile(name, function () {
            return next(names.shift());
        });
    };

    return next(names.shift());
};

module.exports.statFile = function (archive, filename, followLinks) {
    const filesystem = disk.readFilesystemSync(archive);
    return filesystem.getFile(filename, followLinks);
};

module.exports.listPackage = function (archive) {
    return disk.readFilesystemSync(archive).listFiles();
};

module.exports.extractFile = function (archive, filename) {
    const filesystem = disk.readFilesystemSync(archive);
    return disk.readFileSync(filesystem, filename, filesystem.getFile(filename));
};

module.exports.extractAll = function (archive, dest) {
    const filesystem = disk.readFilesystemSync(archive);
    const filenames = filesystem.listFiles();

    // under windows just extract links as regular files
    const followLinks = process.platform === 'win32';

    // create destination directory
    mkdirp.sync(dest);

    return filenames.map((filename) => {
        filename = filename.substr(1); // get rid of leading slash
        const destFilename = path.join(dest, filename);
        const file = filesystem.getFile(filename, followLinks);
        if (file.files) {
            // it's a directory, create it and continue with the next entry
            if (!file.excluded) {
                mkdirp.sync(destFilename);
            }
        } else if (file.link) {
            // it's a symlink, create a symlink
            const linkSrcPath = path.dirname(path.join(dest, file.link));
            const linkDestPath = path.dirname(destFilename);
            const relativePath = path.relative(linkDestPath, linkSrcPath);
            // try to delete output file, because we can't overwrite a link
            (() => {
                try {
                    fs.unlinkSync(destFilename);
                } catch (error) {
                    // ignored
                }
            })();
            const linkTo = path.join(relativePath, path.basename(file.link));
            fs.symlinkSync(linkTo, destFilename);
        } else {
            // it's a file, extract it
            if (!file.excluded) {
                
                const content = disk.readFileSync(filesystem, filename, file);
                fs.writeFileSync(destFilename, content);

                // sha256 it
                let sha = crypto.createHash('sha256');
                let destContents = fs.readFileSync(destFilename);
                sha.update(destContents);
                let checksum = sha.digest('hex');
                if (file.checksum !== checksum) {
                    console.warn(`Warning: checksum for ${destFilename} did not match after extraction`);
                    console.warn(`Expected ${file.checksum} but got ${checksum}`);
                    console.warn('Please verify the contents of the package to make sure alterations did not occur after creation')
                }
            }
        }
    });
};

module.exports.validatePackage = function(archive) {
    const filesystem = disk.readFilesystemSync(archive);
    const filenames = filesystem.listFiles();
    const followLinks = process.platform === 'win32';

    let errored = false;
    filenames.map((filename) => {
        filename = filename.substr(1);
        const file = filesystem.getFile(filename, followLinks);

        if (file.files) {
            // Ignore Directory
        } else if (file.link) {
            // Ignore Symlinks
        } else {
            if (!file.excluded) {
                // sha256 it
                let sha = crypto.createHash('sha256');
                let contents = disk.readFileSync(filesystem, filename, file);
                sha.update(contents);
                let checksum = sha.digest('hex');
                if (file.checksum !== checksum) {
                    errored = true;
                    console.warn(`ERROR: checksum for ${filename} did not match. Corrupted File!!!`);
                    console.warn(`Expected ${file.checksum} but got ${checksum}`);
                }
            }
        }
    });

    if (errored) {
        console.log('Archive is corrupt. You may want to recreate it.');
    } else {
        console.log('All tests succeeded. Archive integrity validated');
    }
};

module.exports.uncache = function (archive) {
    return disk.uncacheFilesystem(archive);
};

module.exports.uncacheAll = function () {
    disk.uncacheAll();
};
