const EventEmitter = require('events')

class ExecuteScript extends EventEmitter {
  command (script) {
    this.api
      .click('#terminalCli')
      .keys(script)
      .keys(this.api.Keys.ENTER)
      .keys(this.api.Keys.ENTER) // that's a bug... sometimes we need to press 2 times to execute a command
      .perform(() => {
        this.emit('complete')
      })
    return this
  }
}

module.exports = ExecuteScript
