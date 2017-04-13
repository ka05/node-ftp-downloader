var Client = require('ssh2').Client;
var _ = require('lodash');
var Promise = require('bluebird');
var moment = require('moment');

var fs = require('fs');
var read = require('fs-readdir-recursive');
var exec = require('child_process').exec;

var mkdirp = require('mkdirp');
var ProgressBar = require('progress');

var SSH2Utils = require('ssh2-utils');
var ssh = new SSH2Utils();

let SftpClient = require('ssh2-sftp-client');
let sftp = new SftpClient();

var connectionOptions = require('./_config.json');

var MAX_SIMULTANEOUS_FILE_DOWNLOADS = 5;
var NUM_SECS = 5;

var log = require('./logUtil');

var downloadDir = '/home22/ka05/completed_downloads/queued_files'; // '/home22/ka05/completed_downloads/';
var localDirectory = '/Users/envative/Downloads/test';
// var localDirectory = '/Volumes/Seagate4TB/Downloads';
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
function getConnection(){
  return sftp.connect(connectionOptions);
}
var connection = getConnection();

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
                log.infoLog("\nDownload Started: " +
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
                    log.infoLog("Downloaded: [local:"+ fileSizeInBytes + ", server: "+ fileInfo.size +"]");
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
                    if (err) log.errorLog("getFile Error: " + err);
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
                log.errorLog("Download Failed with exception: " + e);
              }

            } else {
              // if local directory doesnt exist yet create it
              mkdirp(localFilename,
                function (err) {

                  if (err) {
                    log.errorLog("mkdir Error: " + err);
                    resolveMap();
                  } else {
                    log.successLog("Downloading files for: [" + serverFilename + " -> " + localFilename + " ]");
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
        log.errorLog(err, 'catch error');
      });
  });
}


// handle extracting all downloaded files
function extractFile(filename) {
  return new Promise(function (resolve, reject) {

    log.infoLog("Extraction: Executing Command: \n\t" +
      "unrar e " + filename + " " + localDirectory + "/extracted");

    exec("unrar e " + filename + " " + localDirectory + "/extracted", function (error) {
      if (error){
        log.errorLog(error);
        resolve(error);
      }
      else {
        // success code here
        log.successLog("\tSuccessfully unrar-ed file: " + filename);
        resolve();
      }
    });
  });
}

function renameFile(filename) {
  return new Promise(function (resolve, reject) {

    log.infoLog("Renaming: Executing Command: \n\t" +
      "tvnamer -b " + filename);

    exec("tvnamer -b --config=tvnamerconfig.json " + filename, function (error) {
      if (error) {
        // error code here
        log.errorLog(error);
        resolve(error);
      } else {
        // success code here
        log.successLog("Successfully renamed file: " + filename);
        resolve();
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
      log.successLog("File Download Complete!");

      // if you want to extract the files after done downloading
      if (extractPostDownload) {
        extractAndRename(localDir, renameShowsPostDownload);
      }
    });
}


function extractAndRename(directoryPath, renameShowsPostDownload) {

  var finishExtraction = function () {

    // filter out list of "extractable" files
    var extractableFiles = _.filter(localFiles, function (filename) {
      return filename.indexOf(".rar") != -1;
    });

    log.infoLog("\nExtraction: ExtractableFiles Size: " + ((extractableFiles) ? extractableFiles.length : 0));

    // if we have files to extract
    if(extractableFiles && extractableFiles.length > 0){
      log.infoLog("Extraction: Started");

      // start extracting files
      Promise
        .all(extractableFiles.map(extractFile))
        .then(function(res) {
          log.successLog("Extraction: Complete");

          if(renameShowsPostDownload){
            bulkRename(localDirectory +"/extracted");
          }
        });

    }else{
      log.infoLog("finishExtraction: No Files to Extract");
      process.exit();
    }
  };

  // get list of downloaded local filenames
  var localFiles = _.map(logFile.downloadedFiles, function(lf){
    return lf.localFilename;
  });

  if(directoryPath){
    var extFiles = read(directoryPath);

    extFiles = _.filter(extFiles, function (file) {
      return file.indexOf(".rar") != -1;
    });

    localFiles = _.map(extFiles, function (file) {
      return directoryPath + "/" + file;
    });

    log.infoLog("Extraction: Files to Extract: \n\n\t" + extFiles.join("\n\t"));
    finishExtraction();
  }else{
    finishExtraction();
  }

}

function bulkRename(directoryPath){
  fs.readdir(directoryPath, (err, files) => {
    var extractedFiles = [];
    files.forEach(file => {
      if(file != ".DS_Store"){
        extractedFiles.push(file);
      }
    });

    if(extractedFiles.length > 0){
      log.infoLog("Renaming: Started");

      // start renaming files
      var renamingMap = Promise.map(extractedFiles, function (file) {
        return renameFile(directoryPath + "/" + file);
      });

      renamingMap.then(function () {
        log.successLog("Renaming: Complete");
        process.exit();
      });
    }else{
      log.infoLog("Renaming: No Extracted Files to Rename");
      process.exit();
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


// this will simply extract and rename files from the desired directory:
// WARNING! this will search recursively through the directory you pass in ( use with caution )
// extractAndRename(localDirectory);


// bulkRename(localDirectory +"/extracted");