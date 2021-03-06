'use strict';
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const pickle = require('chromium-pickle-js');
const cjs = require('compressjs');
const Filesystem = require('./filesystem');
let filesystemCache = {};

const copyFileToSync = function (dest, src, filename) {
    const srcFile = path.join(src, filename);
    const targetFile = path.join(dest, filename);

    const content = fs.readFileSync(srcFile);
    const stats = fs.statSync(srcFile);
    mkdirp.sync(path.dirname(targetFile));
    return fs.writeFileSync(targetFile, content, { mode: stats.mode });
};

const writeFileListToStream = function (dest, filesystem, out, list, metadata, callback) {
    if (list.length === 0) {
        out.end();
        return callback(null);
    }

    const file = list[0];
    if (file.excluded) {
        // the file should not be included in the archive.
        return writeFileListToStream(dest, filesystem, out, list.slice(1), metadata, callback);
    }
    const comp = file.compress;
    if (comp) {
        let contents = fs.readFileSync(file.filename);
        let algo = cjs.selectAlgorithm(filesystem.compressionType);
        let cbuf = algo.compressFile(contents, null, filesystem.compressionLevel);
        out.write(cbuf);
        return writeFileListToStream(dest, filesystem, out, list.slice(1), metadata, callback);
    } else {
    const stream = fs.createReadStream(file.filename);
    stream.pipe(out, { end: false });
    stream.on('error', callback);
    return stream.on('end', function () {
        return writeFileListToStream(dest, filesystem, out, list.slice(1), metadata, callback);
    });
    }
};

module.exports.writeFilesystem = function (dest, filesystem, files, metadata, callback) {
    let sizeBuf;
    let headerBuf;
    try {
        const headerPickle = pickle.createEmpty();
        headerPickle.writeString(JSON.stringify(filesystem.header));
        headerBuf = headerPickle.toBuffer();

        const sizePickle = pickle.createEmpty();
        sizePickle.writeUInt32(headerBuf.length);
        sizeBuf = sizePickle.toBuffer();
    } catch (error) {
        return callback(error);
    }

    const out = fs.createWriteStream(dest);
    out.on('error', callback);
    out.write(sizeBuf);
    return out.write(headerBuf, function () {
        return writeFileListToStream(dest, filesystem, out, files, metadata, callback);
    });
};

module.exports.readArchiveHeaderSync = function (archive) {
    const fd = fs.openSync(archive, 'r');
    let size;
    let headerBuf;
    try {
        const sizeBuf = new Buffer(8);
        if (fs.readSync(fd, sizeBuf, 0, 8, null) !== 8) {
            throw new Error('Unable to read header size');
        }

        const sizePickle = pickle.createFromBuffer(sizeBuf);
        size = sizePickle.createIterator().readUInt32();
        headerBuf = new Buffer(size);
        if (fs.readSync(fd, headerBuf, 0, size, null) !== size) {
            throw new Error('Unable to read header');
        }
    } finally {
        fs.closeSync(fd);
    }

    const headerPickle = pickle.createFromBuffer(headerBuf);
    const header = headerPickle.createIterator().readString();
    return { header: JSON.parse(header), headerSize: size };
};

module.exports.readFilesystemSync = function (archive) {
    if (!filesystemCache[archive]) {
        const header = this.readArchiveHeaderSync(archive);
        const filesystem = new Filesystem(archive);
        filesystem.header = header.header;
        filesystem.headerSize = header.headerSize;
        filesystem.postInitHeader();
        filesystemCache[archive] = filesystem;
    }
    return filesystemCache[archive];
};

module.exports.uncacheFilesystem = function (archive) {
    if (filesystemCache[archive]) {
        filesystemCache[archive] = undefined;
        return true;
    }
    return false;
};

module.exports.uncacheAll = function () {
    filesystemCache = {};
};

module.exports.readFileSync = function (filesystem, filename, info) {
    if (!info.size || info.excluded) {
        return new Buffer(0);
    }
    let buffer = new Buffer(info.size);
    if (info.size <= 0) {
        return buffer;
    }
    if (!info.excluded) {
        // Node throws an exception when reading 0 bytes into a 0-size buffer,
        // so we short-circuit the read in this case.
        const fd = fs.openSync(filesystem.src, 'r');
        try {
            const offset = 8 + filesystem.headerSize + parseInt(info.offset);
            
            if (info.compressed) {
                let cbuf = new Buffer(info.csize);
                fs.readSync(fd, cbuf, 0, info.csize, offset);
                let algo = cjs.selectAlgorithm(filesystem.compressionType);
                buffer = algo.decompressFile(cbuf);
            } else {
                fs.readSync(fd, buffer, 0, info.size, offset);
            }
        } finally {
            fs.closeSync(fd);
        }
    }
    return buffer;
};
