var Client = require('ssh2').Client;
var _ = require('lodash');
var Promise = require('bluebird');
var moment = require('moment');

var fs = require('fs');
var mkdirp = require('mkdirp');

var SSH2Utils = require('ssh2-utils');
var ssh = new SSH2Utils();

let SftpClient = require('ssh2-sftp-client');
let sftp = new SftpClient();

var connectionOptions = require('_config.json');

var MAX_SIMULTANIOUS_FILE_DOWNLOADS = 3;
var downloadDir = '/home22/ka05/completed_downloads/queued_files'; // '/home22/ka05/completed_downloads/';
var localDirectory = '/Users/envative/Downloads/test';
var logFilePath = localDirectory + '/fileDownloadLog.json';
var logFile = require(logFilePath);

var connection = sftp.connect(connectionOptions);

//TODO: look into using this library for download progress :https://github.com/visionmedia/node-progress

// get files for a directory
function getFiles(connection, serverPath, localPath, callback) {
    return new Promise(function(resolve, reject) {
        connection
            .then(() => {
                return sftp.list(serverPath);
            })
            .then((data) => {

                // filter out filenames of things we already have
                var filesToGet = _.filter(data, function(file) {
                    return logFile.downloadedFiles.indexOf(file.name) == -1;
                });

                // for each file we need to get -> drill down and get everything
                var getFilesPromiseMap = Promise.map(filesToGet, function(fileInfo) {
                    return new Promise(function(resolveMap, rejectMap) {

                        var serverFilename = serverPath + "/" + fileInfo.name;
                        var localFilename = localPath + "/" + fileInfo.name;

                        // if file is not directory -> download it
                        if (fileInfo.type != "d") {
                            try {
                                console.log("Downloading file: [" + serverFilename + " -> " + localFilename + " ]");
                                ssh.getFile(connectionOptions,
                                    serverFilename, localFilename,
                                    (err, server, connection) => {
                                        if (err) console.log("getFile Error: " + err);
                                        else {
                                            console.log("File Download Success: " +
                                                "[" + serverFilename + " -> " + localFilename + " ]");

                                            // add to list of files that already downloaded
                                            logFile.downloadedFiles.push(serverFilename);

                                        }
                                        resolveMap();
                                    });
                            } catch (e) {
                                console.log("Download Failed with exception: " + e);
                            }

                        } else {
                            // if local directory doesnt exist yet create it
                            mkdirp(localFilename,
                                function(err) {

                                    if (err) {
                                        console.log("mkdir Error: " + err);
                                        resolveMap();
                                    } else {
                                        console.log("Downloading files for: [" + serverFilename + " -> " + localFilename + " ]");
                                        // if its a directory -> call recursively
                                        getFiles(connection, serverFilename, localFilename)
                                            .then(resolveMap, rejectMap);
                                    }
                                });
                        }

                    });
                }, { concurrency: MAX_SIMULTANIOUS_FILE_DOWNLOADS });

                // after map completes downloading
                getFilesPromiseMap.then(function() {
                    resolve();
                }, function() {
                    reject();
                });

            })
            .catch((err) => {
                console.log(err, 'catch error');
            });
    });
}


// handle extracting all downloaded files
function extractFile(filename) {
    return new Promise(function(resolve, reject) {
        // var filename = '/Users/envative/Downloads/test/The.Flash.2014.S03E15.720p.HDTV.X264-DIMENSION/the.flash.315.720p-dimension.rar';
        var exec = require('child_process').exec;

        exec("open " + filename, function(error) {
            if (error) {
                // error code here
                console.log(error);
            } else {
                // success code here
                console.log("Successfully unrar-ed file: " + filename);
            }
        });
    });
}

// Main Download processor method
function startDownload(options) {
    var serverDir = options.serverDir;
    var localDir = options.localDir;
    var extractPostDownload = options.extractPostDownload;

    getFiles(connection, serverDir, localDir) // start getting files. ( NOTE: this will call recursively. be careful )
        .then(function() {
            // When done getting all files -> write them to log filename
            fs.writeFile(logFilePath, JSON.stringify({ downloadedFiles: logFile.downloadedFiles, lastFetched: moment().format() }, null, 4));
            console.log("File Download Complete!");

            // if you want to extract the files after done downloading
            if (extractPostDownload) {
                console.log("File Extraction Started");

                // filter out list of "extractable" files
                var extractableFiles = _.filter(logFile.downloadedFiles, function(filename) {
                    return filename.indexOf(".rar") != -1;
                });

                // start extracting files
                var extractionMap = Promise.map(extractableFiles, function(file) {
                    return extractFile(file);
                });

                // extraction is complete
                extractionMap.then(function() {
                    console.log("File Extraction Complete");
                });
            }
        });
}

// call with defaults
startDownload({
    serverDir: downloadDir,
    localDir: localDirectory,
    extractPostDownload: true,
});