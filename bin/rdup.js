#!/usr/bin/env node
'use strict';
const rdup = require('../lib/rdup');
const program = require('commander');

program.version('v' + require('../package.json').version)
    .description('Manipulate rdup archive files');

program.command('pack <dir> <output>')
    .alias('p')
    .description('create rdup archive')
    .option('--ordering <file path>', 'path to a text file for ordering contents')
    .option('--exclude <expression>', 'exclude files matching glob <expression>')
    .option('--exclude-dir <expression>', 'exclude dirs matching glob <expression> or starting with literal <expression>')
    .option('--exclude-hidden', 'exclude hidden files')
    .action(function (dir, output, options) {
        options = {
            exclude: options.exclude,
            excludeDir: options.excludeDir,
            ordering: options.ordering,
            dot: !options.excludeHidden
        };
        rdup.createPackageWithOptions(dir, output, options, function (error) {
            if (error) {
                console.error(error.stack);
                process.exit(1);
            }
        });
    });

program.command('list <archive>')
    .alias('l')
    .description('list files of rdup archive')
    .action(function (archive) {
        let files = rdup.listPackage(archive);
        for (let i in files) {
            if (i) {
                console.log(files[i]);
            }
        }
    });

program.command('extract-file <archive> <filename>')
    .alias('ef')
    .description('extract one file from archive')
    .action(function (archive, filename) {
        require('fs').writeFileSync(require('path').basename(filename),
            rdup.extractFile(archive, filename));
    });

program.command('extract <archive> <dest>')
    .alias('e')
    .description('extract archive')
    .action(function (archive, dest) {
        rdup.extractAll(archive, dest);
    });

program.command('check <archive>')
    .alias('c')
    .description('check archive for corrupt files')
    .action(function (archive) {
        rdup.validatePackage(archive);
    });

program.command('*')
    .action(function (cmd) {
        console.log('rdup: \'%s\' is not an rdup command. See \'rdup --help\'.', cmd);
    });

program.parse(process.argv);

if (program.args.length === 0) {
    program.help();
}
