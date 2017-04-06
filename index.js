var Client = require('ssh2').Client;
var _ = require('lodash');
var Promise = require('bluebird');
var moment = require('moment');

var fs = require('fs');
var mkdirp = require('mkdirp');
var ProgressBar = require('progress');

var SSH2Utils = require('ssh2-utils');
var ssh = new SSH2Utils();

let SftpClient = require('ssh2-sftp-client');
let sftp = new SftpClient();

var connectionOptions = require('./_config.json');

var MAX_SIMULTANEOUS_FILE_DOWNLOADS = 5;
var NUM_SECS = 5;

var downloadDir = '/home22/ka05/completed_downloads/queued_files'; // '/home22/ka05/completed_downloads/';
// var localDirectory = '/Users/envative/Downloads/test';
var localDirectory = '/Volumes/Seagate4TB/Downloads';
var logFilePath = localDirectory + '/fileDownloadLog.json';
var logFile = require(logFilePath);

// example _.config.json
/*
 {
 "host": "192.168.1.1",
 "port": 22,
 "username": "your_username",
 "password": "your_password"
 }
 */

var connection = sftp.connect(connectionOptions);

//TODO: look into using this library for download progress :https://github.com/visionmedia/node-progress

// get files for a directory
function getFiles(connection, serverPath, localPath, callback) {
  return new Promise(function (resolve, reject) {
    connection
      .then(() => {
        return sftp.list(serverPath);
      })
      .then((data) => {

        // get list of downloaded server filenames
        var downloadedFiles = _.map(logFile.downloadedFiles, function(lf){
          return lf.serverFilename;
        });

        // filter out filenames of things we already have
        var filesToGet = _.filter(data, function (file) {
          return downloadedFiles.indexOf(serverPath + "/" +file.name) == -1;
        });

        // for each file we need to get -> drill down and get everything
        var getFilesPromiseMap = Promise.map(filesToGet, function (fileInfo) {
          return new Promise(function (resolveMap, rejectMap) {

            var serverFilename = serverPath + "/" + fileInfo.name;
            var localFilename = localPath + "/" + fileInfo.name;

            // if file is not directory -> download it
            if (fileInfo.type != "d") {
              try {
                console.log("\nDownload Started: " +
                  "\n\tServer Filename: " + serverFilename +
                  "\n\tLocal Filename: " + localFilename);

                // start timer to show progress:
                // show progress bar : start at 0

                var progressUpdateInterval;
                var progressString = '  downloading [:bar] :rate/bps :percent :etas';
                var bar = new ProgressBar(progressString, {
                  complete: '=',
                  incomplete: ' ',
                  width: 50,
                  total: fileInfo.size,
                  callback:function(){
                    var stats = fs.statSync(localFilename);
                    var fileSizeInBytes = stats.size;
                    console.log("Downloaded: [local:"+ fileSizeInBytes + ", server: "+ fileInfo.size +"]");
                    clearInterval(progressUpdateInterval);
                  }
                });

                setTimeout(function(){

                  var previousFileSize;
                  progressUpdateInterval = setInterval(function(){

                    // check local file byte size and divide by total byte size for percentage
                    var stats = fs.statSync(localFilename);
                    var fileSizeInBytes = stats.size;
                    var sizeStep = fileSizeInBytes;

                    if(previousFileSize){
                      sizeStep = fileSizeInBytes - previousFileSize;
                    }
                    previousFileSize = fileSizeInBytes;

                    var percentage =  fileSizeInBytes / fileInfo.size;
                    percentage = parseFloat(Math.round(percentage * 100)).toFixed(2);
                    // console.log("Filename: "+ localFilename +" percentage: " + percentage);
                    bar.tick(sizeStep);

                  }, 250); // every half sec

                }, NUM_SECS * 1000);

                ssh.getFile(connectionOptions,
                  serverFilename, localFilename,
                  (err, server, connection) => {
                    if (err) console.log("getFile Error: " + err);
                    else {
                      // console.log("\nFile Download Success: " +
                      //   "\n\tServer Filename: " + serverFilename +
                      //   "\n\tLocal Filename: " + localFilename);

                      // add to list of files that already downloaded
                      logFile.downloadedFiles.push({serverFilename:serverFilename, localFilename:localFilename, size:fileInfo.size});
                      updateLogFile();
                    }
                    resolveMap();
                  });

              } catch (e) {
                console.log("Download Failed with exception: " + e);
              }

            } else {
              // if local directory doesnt exist yet create it
              mkdirp(localFilename,
                function (err) {

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
        }, {concurrency: MAX_SIMULTANEOUS_FILE_DOWNLOADS});

        // after map completes downloading
        getFilesPromiseMap.then(function () {
          resolve();
        }, function () {
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
  return new Promise(function (resolve, reject) {
    // var filename = '/Users/envative/Downloads/test/The.Flash.2014.S03E15.720p.HDTV.X264-DIMENSION/the.flash.315.720p-dimension.rar';
    var exec = require('child_process').exec;

    exec("unrar e " + filename + " extracted", function (error) {
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

function renameFile(filename) {
  return new Promise(function (resolve, reject) {
    // var filename = '/Users/envative/Downloads/test/The.Flash.2014.S03E15.720p.HDTV.X264-DIMENSION/the.flash.315.720p-dimension.rar';
    var exec = require('child_process').exec;

    exec("tvnamer -b " + filename, function (error) {
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

function updateLogFile(){
  fs.writeFile(logFilePath, JSON.stringify({
    downloadedFiles: logFile.downloadedFiles,
    lastFetched: moment().format()
  }, null, 4));
}

// Main Download processor method
function startDownload(options) {
  var serverDir = options.serverDir;
  var localDir = options.localDir;
  var extractPostDownload = options.extractPostDownload;
  var renameShowsPostDownload = options.renameShowsPostDownload;

  getFiles(connection, serverDir, localDir) // start getting files. ( NOTE: this will call recursively. be careful )
    .then(function () {
      // When done getting all files -> write them to log filename

      // save filesize, local and server paths
      updateLogFile();

      console.log("File Download Complete!");

      // if you want to extract the files after done downloading
      if (extractPostDownload) {

        // get list of downloaded local filenames
        var localFiles = _.map(logFile.downloadedFiles, function(lf){
          return lf.localFilename;
        });

        // filter out list of "extractable" files
        var extractableFiles = _.filter(localFiles, function (filename) {
          return filename.indexOf(".rar") != -1;
        });

        console.log("Extraction: ExtractableFiles Size: " + (extractableFiles) ? extractableFiles.length : 0);

        // if we have files to extract
        if(extractableFiles && extractableFiles.length > 0){
          console.log("Extraction: Started");

          // start extracting files
          var extractionMap = Promise.map(extractableFiles, function (file) {
            return extractFile(file);
          });

          // extraction is complete
          extractionMap.then(function () {
            console.log("Extraction: Complete");

            if (renameShowsPostDownload) {

              fs.readdir(localDirectory +"/extracted", (err, files) => {
                var extractedFiles = [];
                files.forEach(file => {
                  console.log(file);
                  extractedFiles.push(file);
                });

                if(extractedFiles.length > 0){
                  console.log("Renaming: Started");

                  // start renaming files
                  var renamingMap = Promise.map(extractableFiles, function (file) {
                    return renameFile(file);
                  });

                  renamingMap.then(function () {
                    console.log("Renaming: Complete");
                  });
                }

              });

            }
          });

        }

      }
    });
}

// call with defaults
startDownload({
  serverDir: downloadDir,
  localDir: localDirectory,
  extractPostDownload: true,
  renameShowsPostDownload: true
});