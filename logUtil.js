/**
 * Created by clay on 4/9/17.
 */
var colors = require('colors/safe');

colors.setTheme({
  silly: 'rainbow',
  input: 'grey',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'green',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
});

module.exports = {

  successLog:function (msg) {
    console.log(colors.info(msg));
  },

  errorLog:function (err) {
    console.log(colors.error(err));
  },

  infoLog:function (err) {
    console.log(colors.warn(err));
  }

};