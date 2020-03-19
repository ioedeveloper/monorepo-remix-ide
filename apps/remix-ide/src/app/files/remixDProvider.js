'use strict'
var EventManager = require('../../lib/events')
var pathtool = require('path')

module.exports = class RemixDProvider {
  constructor (remixd) {
    this.event = new EventManager()
    this._remixd = remixd
    this.remixd = remixapi(remixd, this)
    this.type = 'localhost'
    this.error = { 'EEXIST': 'File already exists' }
    this._isReady = false
    this._readOnlyFiles = {}
    this._readOnlyMode = false
    this.filesContent = {}
    this.files = {}

    var remixdEvents = ['connecting', 'connected', 'errored', 'closed']
    remixdEvents.forEach((value) => {
      remixd.event.register(value, (event) => {
        this.event.trigger(value, [event])
      })
    })

    remixd.event.register('notified', (data) => {
      if (data.scope === 'sharedfolder') {
        if (data.name === 'created') {
          this.init(() => {
            this.event.trigger('fileAdded', [this.type + '/' + data.value.path, data.value.isReadOnly, data.value.isFolder])
          })
        } else if (data.name === 'removed') {
          this.init(() => {
            this.event.trigger('fileRemoved', [this.type + '/' + data.value.path])
          })
        } else if (data.name === 'changed') {
          this._remixd.call('sharedfolder', 'get', {path: data.value}, (error, content) => {
            if (error) {
              console.log(error)
            } else {
              var path = this.type + '/' + data.value
              this.filesContent[path] = content
              this.event.trigger('fileExternallyChanged', [path, content])
            }
          })
        } else if (data.name === 'rootFolderChanged') {
          // new path has been set, we should reset
          this.event.trigger('folderAdded', [this.type + '/'])
        }
      }
    })
  }

  isConnected () {
    return this._isReady
  }

  close (cb) {
    this.remixd.exit()
    this._isReady = false
    cb()
  }

  init (cb) {
    this._remixd.ensureSocket((error) => {
      if (error) return cb(error)
      this._isReady = !error
      this._remixd.call('sharedfolder', 'folderIsReadOnly', {}, (error, result) => {
        this._readOnlyMode = result
        cb(error)
      })
    })
  }

  // @TODO: refactor all `this._remixd.call(....)` uses into `this.remixd[api](...)`
  // where `api = ...`:
  // this.remixd.read(path, (error, content) => {})
  // this.remixd.write(path, content, (error, result) => {})
  // this.remixd.rename(path1, path2, (error, result) => {})
  // this.remixd.remove(path, (error, result) => {})
  // this.remixd.dir(path, (error, filesList) => {})
  //
  // this.remixd.exists(path, (error, isValid) => {})

  exists (path, cb) {
    var unprefixedpath = this.removePrefix(path)
    this._remixd.call('sharedfolder', 'exists', {path: unprefixedpath}, (error, result) => {
      cb(error, result)
    })
  }

  get (path, cb) {
    var unprefixedpath = this.removePrefix(path)
    this._remixd.call('sharedfolder', 'get', {path: unprefixedpath}, (error, file) => {
      if (!error) {
        this.filesContent[path] = file.content
        if (file.readonly) { this._readOnlyFiles[path] = 1 }
        cb(error, file.content)
      } else {
        // display the last known content.
        // TODO should perhaps better warn the user that the file is not synced.
        cb(null, this.filesContent[path])
      }
    })
  }

  set (path, content, cb) {
    var unprefixedpath = this.removePrefix(path)
    this._remixd.call('sharedfolder', 'set', {path: unprefixedpath, content: content}, (error, result) => {
      if (cb) return cb(error, result)
      var path = this.type + '/' + unprefixedpath
      this.event.trigger('fileChanged', [path])
    })
    return true
  }

  isReadOnly (path) {
    return this._readOnlyMode || this._readOnlyFiles[path] === 1
  }

  remove (path) {
    var unprefixedpath = this.removePrefix(path)
    this._remixd.call('sharedfolder', 'remove', {path: unprefixedpath}, (error, result) => {
      if (error) console.log(error)
      var path = this.type + '/' + unprefixedpath
      delete this.filesContent[path]
      this.init(() => {
        this.event.trigger('fileRemoved', [path])
      })
    })
  }

  rename (oldPath, newPath, isFolder) {
    var unprefixedoldPath = this.removePrefix(oldPath)
    var unprefixednewPath = this.removePrefix(newPath)
    this._remixd.call('sharedfolder', 'rename', {oldPath: unprefixedoldPath, newPath: unprefixednewPath}, (error, result) => {
      if (error) {
        console.log(error)
        if (this.error[error.code]) error = this.error[error.code]
        this.event.trigger('fileRenamedError', [this.error[error.code]])
      } else {
        var newPath = this.type + '/' + unprefixednewPath
        var oldPath = this.type + '/' + unprefixedoldPath
        this.filesContent[newPath] = this.filesContent[oldPath]
        delete this.filesContent[oldPath]
        this.init(() => {
          this.event.trigger('fileRenamed', [oldPath, newPath, isFolder])
        })
      }
    })
    return true
  }

  isExternalFolder (path) {
    return false
  }

  removePrefix (path) {
    path = path.indexOf(this.type) === 0 ? path.replace(this.type, '') : path
    if (path[0] === '/') return path.substring(1)
    return path
  }

  resolveDirectory (path, callback) {
    var self = this
    if (path[0] === '/') path = path.substring(1)
    if (!path) return callback(null, { [self.type]: { } })
    path = self.removePrefix(path)
    self.remixd.dir(path, callback)
  }
}

function remixapi (remixd, self) {
  const read = (path, callback) => {
    path = '' + (path || '')
    path = pathtool.join('./', path)
    remixd.call('sharedfolder', 'get', { path }, (error, content) => callback(error, content))
  }
  const write = (path, content, callback) => {
    path = '' + (path || '')
    path = pathtool.join('./', path)
    remixd.call('sharedfolder', 'set', { path, content }, (error, result) => callback(error, result))
  }
  const rename = (path, newpath, callback) => {
    path = '' + (path || '')
    path = pathtool.join('./', path)
    remixd.call('sharedfolder', 'rename', { oldPath: path, newPath: newpath }, (error, result) => callback(error, result))
  }
  const remove = (path, callback) => {
    path = '' + (path || '')
    path = pathtool.join('./', path)
    remixd.call('sharedfolder', 'remove', { path }, (error, result) => callback(error, result))
  }
  const dir = (path, callback) => {
    path = '' + (path || '')
    path = pathtool.join('./', path)
    remixd.call('sharedfolder', 'resolveDirectory', { path }, (error, filesList) => callback(error, filesList))
  }
  const exit = () => { remixd.close() }
  const api = { read, write, rename, remove, dir, exit, event: remixd.event }
  return api
}
