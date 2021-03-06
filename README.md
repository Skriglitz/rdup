# RDUP (Rapid Deployment Update Packager)

[![Dependencies Status](https://david-dm.org/Skriglitz/rdup/status.png)](https://david-dm.org/Skriglitz/rdup)
[![GitHub issues](https://img.shields.io/github/issues/Skriglitz/rdup.svg)](https://github.com/Skriglitz/rdup/issues)
[![GitHub forks](https://img.shields.io/github/forks/Skriglitz/rdup.svg)](https://github.com/Skriglitz/rdup/network)
[![GitHub license](https://img.shields.io/github/license/Skriglitz/rdup.svg)](https://github.com/Skriglitz/rdup/blob/master/LICENSE)

RDUP is package management system designed to enable developers to rapidly deploy updates to users while maintaining file integrity and reducing bandwidth for sequential updates

***
## Features

* Support random access
* Use JSON to store files' information
* Very easy to write a parser
* Supports Checksums for file verification 
* Supports compression to shrink package contents

## Supported Algorithms

### Compression Algorithms
* BWTC [Supports Level 1-9]
* Bzip2 [Supports Level 1-9]
* Dmc
* Lzjb [Supports Level 1-9]
* LzjbR [Supports Level 1-9]
* Lzp3
* PPM

### Hash Algorithms
* MD5
* SHA
* SHA224
* SHA256
* SHA384
* SHA512
* Whirlpool

## Command line utility

### Install

```bash
$ npm install rdup
```

### Usage

```bash
$ rdup --help

  Usage: rdup [options] [command]

  Commands:

    pack|p [options] <dir> <output>
       create rdup archive
       Options:
          --ordering <file path>        path to a text file for ordering contents
          --exclude <expression>        exclude files matching glob <expression>
          --exclude-dir <expression>    exclude dirs matching glob <expression> or starting with literal <expression>
          --exclude-hidden              exclude hidden files
          --no-compress <expression>    do not compress files matching <expression>
          --hash <type>                 use hashing algorithm <type> for checksums
          --algo <type>                 compress files using <type> algorithm
          --level <level>               compression level, Valid options: 1-9

    list|l <archive>
       list files of rdup archive

    extract-file|ef <archive> <filename>
       extract one file from archive

    extract|e <archive> <dest>
       extract archive

    check|c <archive>
       check archive for corrupt files

    algorithms
        Show supported hash and compression algorithms

  Options:

    -h, --help     output usage information
    -V, --version  output the version number

```

#### Excluding multiple resources from being packed

Given:
```
    app
(a) ├── x1
(b) ├── x2
(c) ├── y3
(d) │   ├── x1
(e) │   └── z1
(f) │       └── x2
(g) └── z4
(h)     └── w1
```

Exclude: a, b
```bash
$ rdup pack app app.rup --exclude-dir "{x1,x2}"
```

Exclude: a, b, d, f
```bash
$ rdup pack app app.rup --exclude-dir "**/{x1,x2}"
```

Exclude: a, b, d, f, h
```bash
$ rdup pack app app.rup --exclude-dir "{**/x1,**/x2,z4/w1}"
```

## Using programatically

### Example

```js
var rdup = require('rdup');

var src = 'some/path/';
var dest = 'name.rup';

rdup.createPackage(src, dest, function() {
  console.log('done.');
})
```

Please note that there is currently **no** error handling provided!

## Format

RDUP uses [Pickle][pickle] to safely serialize binary value to file, there is
also a [node.js binding][node-pickle] of `Pickle` class.

The format of rup files is very flat:

```
| UInt32: header_size | String: header | Bytes: file1 | ... | Bytes: file42 |
```

The `header_size` and `header` are serialized with [Pickle][pickle] class, and
`header_size`'s [Pickle][pickle] object is 8 bytes.

The `header` is a JSON string, and the `header_size` is the size of `header`'s
`Pickle` object.

Structure of `header` is something like this:

```json
{
  "files": {
    "tmp": {
      "files": {}
    },
    "usr": {
      "files": {
        "bin": {
          "files": {
            "ls": {
              "offset": "0",
              "size": 100,
              "executable": true,
              "checksum": "<truncated>",
              "compressed": true,
              "csum": "<truncated>",
              "csize": 74
            },
            "cd": {
              "offset": "74",
              "size": 100,
              "executable": true,
              "checksum": "<truncated>",
              "compressed": true,
              "csum": "<truncated>",
              "csize": 74
            }
          }
        }
      }
    },
    "etc": {
      "files": {
        "hosts": {
          "offset": "148",
          "size": 32,
          "checksum": "<truncated>",
          "compressed": true,
          "csum": "<truncated>",
          "csize": 18
        }
      }
    }
  }
}
```

`offset`, `size`, and `checksum` records the information to read the file from
archive, the `offset` starts from 0 so you have to manually add the size of
`header_size` and `header` to the `offset` to get the real offset of the file.

`offset` is a UINT64 number represented in string, because there is no way to
precisely represent UINT64 in JavaScript `Number`.

`size` is a JavaScript `Number` that is no larger than `Number.MAX_SAFE_INTEGER`,
which has a value of `9007199254740991` and is about 8PB in size. We didn't
store `size` in UINT64 because file size in Node.js is represented as `Number`
and it is not safe to convert `Number` to UINT64.

`checksum` is a SHA-256 hash represented in a hexadecimal string for the file
used for file verification. This is stored so that should a file become corrupt
a new copy can be extracted without extracting the entire package

When compression is enabled `compressed`, `csum`, `csize` record information
for the compression.

`compressed` is a JavaScript `Boolean` representing if a file is compressed
using Bzip2. This is so that with future versions specific files can be
compressed in case certain files would be come larger than their uncompressed
counterpart.

`csum` is a SHA-256 hash represented in a hexadecimal string for the compressed
file used for file verification. This is stored to make sure should a
file become corrupt that it will not cause an overflow or a corrupt extraction.

`csize` is a JavaScript `Number` used to represent the size of the compressed
file data. `csize` is also used during the packaging process to increment `offset`
accordingly to prevent overreading the buffer.

[pickle]: https://chromium.googlesource.com/chromium/src/+/master/base/pickle.h
[node-pickle]: https://www.npmjs.org/package/chromium-pickle

## Information

RDUP is a modified fork of [Electron ASAR](https://github.com/electron/asar),
and is maintained by Skriglitz of TriFractal Studios and is made available under the MIT License