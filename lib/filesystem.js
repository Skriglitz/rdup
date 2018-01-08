'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const tmp = require('tmp');
const cuint = require('cuint');
const uint64 = cuint.UINT64;
const cjs = require('compressjs');

class Filesystem {
    constructor(src) {
        this.src = path.resolve(src);
        this.header = { files: {} };
        this.headerSize = 0;
        this.offset = uint64(0, 0, 0, 0);
        this.checksumType = 'sha256';
        this.compressionType = 'bzip2';
        this.compressionLevel = 9;
    }

    searchNodeFromDirectory(p) {
        let json = this.header;
        const dirs = p.split(path.sep);
        for (const dir of dirs) {
            if (dir !== '.') {
                json = json.files[dir];
            }
        }
        return json;
    }

    searchNodeFromPath(p) {
        p = path.relative(this.src, p);
        if (!p) {
            return this.header;
        }
        const name = path.basename(p);
        const node = this.searchNodeFromDirectory(path.dirname(p));
        if (node.files == null) {
            node.files = {};
        }
        if (node.files[name] == null) {
            node.files[name] = {};
        }
        return node.files[name];
    }

    insertDirectory(p, shouldExclude) {
        const dirNode = this.searchNodeFromPath(path.dirname(p));
        const node = this.searchNodeFromPath(p);
        if (shouldExclude || dirNode.excluded) {
            node.excluded = true;
        }
        node.files = {};
        return node.files;
    }

    insertFile(p, shouldExclude, shouldCompress, file, options, callback) {
        const dirNode = this.searchNodeFromPath(path.dirname(p));
        //const node = this.searchNodeFromPath(p);
        if (shouldExclude || dirNode.excluded) {
            //node.size = file.stat.size;
            //node.excluded = true;
            process.nextTick(callback);
            return;
        }
        const node = this.searchNodeFromPath(p);

        const handler = () => {
            const size = file.stat.size;

            // JavaScript can not precisely present integers >= UINT32_MAX.
            if (size > 4294967295) {
                throw new Error(`${p}: file size can not be larger than 4.2GB`);
            }

            node.size = size;
            node.offset = this.offset.toString();
            if (process.platform !== 'win32' && (file.stat.mode & 0o100)) {
                node.executable = true;
            }

            let contents = fs.readFileSync(p);
            let hash = crypto.createHash(this.checksumType);
            hash.update(contents);
            node.checksum = hash.digest('hex');

            if (shouldCompress) {
                node.compressed = true;
                let algo = cjs.selectAlgorithm(this.compressionType);
                let cbuf = algo.compressFile(contents, null, this.compressionLevel);
                let csum = crypto.createHash(this.checksumType);
                csum.update(cbuf);
                node.csum = csum.digest('hex');
                node.csize = cbuf.length;
                this.offset.add(uint64(0, 0, 0, 0).fromNumber(node.csize));
            } else {
                this.offset.add(uint64(0, 0, 0, 0).fromNumber(size));
            }

            return callback();
        };

        return process.nextTick(handler);

    }

    insertLink(p) {
        const link = path.relative(fs.realpathSync(this.src), fs.realpathSync(p));
        if (link.substr(0, 2) === '..') {
            throw new Error(`${p}: file links out of the package`);
        }
        const node = this.searchNodeFromPath(p);
        node.link = link;
        return link;
    }

    listFiles() {
        const files = [];
        const fillFilesFromHeader = function (p, json) {
            if (!json.files) {
                return;
            }
            return (() => {
                const result = [];
                for (const f in json.files) {
                    if (f) {
                        const fullPath = path.join(p, f);
                        files.push(fullPath);
                        result.push(fillFilesFromHeader(fullPath, json.files[f]));
                    }
                }
                return result;
            })();
        };

        fillFilesFromHeader('/', this.header);
        return files;
    }

    getNode(p) {
        const node = this.searchNodeFromDirectory(path.dirname(p));
        const name = path.basename(p);
        if (name) {
            return node.files[name];
        }
        return node;

    }

    getFile(p, followLinks) {
        followLinks = typeof followLinks === 'undefined' ? true : followLinks;
        const info = this.getNode(p);

        // if followLinks is false we don't resolve symlinks
        if (info.link && followLinks) {
            return this.getFile(info.link);
        }
        return info;

    }
}

module.exports = Filesystem;