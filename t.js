const chalk = require("chalk");
require("./config.js");
   
   const now = new Date();
        const formattedDate = now.toLocaleDateString();
        const formattedTime = now.toLocaleTimeString();
        console.log(
          ('\n') + 
          chalk.bold.cyan('======')+(" ")+chalk.bold.yellow("[")+(" ")+chalk.bold.cyan("LOG MESSAGE")+(" ")+chalk.bold.yellow("]")+(" ")+chalk.bold.cyan('======') + '\n' + '\n'+
          chalk.bold.cyan('Command    : ') + chalk.bold.yellow(`tes`) + '\n' +
          chalk.bold.cyan('From       : ') + chalk.bold.yellow(`tes`) + '\n' +
          chalk.bold.cyan('Chat Type  : ') + chalk.bold.yellow(`tes`) + '\n' +
          chalk.bold.cyan('Args       : ') + chalk.bold.yellow(`tes`) + '\n' +
          chalk.bold.cyan('Date       : ') + chalk.bold.yellow(`${formattedDate}`) + '\n' +
          chalk.bold.cyan('Time       : ') + chalk.bold.yellow(`${formattedTime}`) + '\n' + '\n' +
          chalk.bold.cyan('====')+(" ")+chalk.bold.yellow("[")+(" ")+chalk.bold.cyan("© 2025 Juli-Cf")+(" ")+chalk.bold.yellow("]")+(" ")+chalk.bold.cyan('=====') + '\n'
        );

