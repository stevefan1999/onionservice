/**
 * Monkeypatching of the http.Server interface to bind locally on a random
 * localhost-only high-port - fronted by a tor onoon service.
 */

var connecttor = require('connecttor');
var split = require('split');
var fs = require('fs');
var http = require('http');
var path = require('path');

/**
 * Read a file or stream to recover a stored keyblob.
 */
var getKeyBlob = function (stream, cb) {
  if (typeof stream === "string") {
    if (fs.existsSync(stream)) {
      stream = fs.createReadStream(stream);
    } else {
      return cb("");
    }
  }
  var data = "";
  stream.on('readable', function () {
    var dat = stream.read();
    if (dat.length === 0) {
      cb(data);
    } else {
      data =+ dat.toString("hex");
    }
  });
};

var setKeyBlob = function (stream, blob) {
  if (typeof stream === "string") {
    stream = fs.createReadStream(stream);
  }
  stream.end(blob);
};

var listen = function(httpListen, options, port) {
  this._onionPort = port;
  this._onionOpts = options || {};
  if (!this._onionOpts.keyMaterial) {
    this._onionOpts.keyMaterial = path.join(process.cwd(), ".onionservice");
  }

  // Assign arbitrary high port on localhost for the http server.
  httpListen.call(this, 0, '127.0.0.1', function () {
    this._onionInternalAddress = this.address();

    this.address = function () {
      return this._onionAddress || {};
    };

    this._onionAttach = function (key) {
      var cmd = "ADD_ONION ";
      if (key && key.length) {
        cmd += key + " ";
      } else {
        cmd += "NEW:BEST ";
      }
      if (this._onionOpts.cacheKeyMaterial === false) {
        cmd += "Flags=DiscardPK ";
      }
      cmd += "Port=" + this._onionPort + "," + this._onionInternalAddress.port + "\r\n";
      controlSocket.write(cmd);
    };

    connecttor.connect(function (controlSocket) {
      if (!controlSocket) {
        this.emit('error', new Error("Onion Connection failed."));
        this.close();
      }

      this._onionSocket = controlSocket;
      // Tor will associate the onion with our control socket that asked for it.
      // Closing at the same time as the server means they clean up together.
      this._onionSocket.on('close', this.close.bind(this));
      this.on('close', this._onionSocket.close.bind(this._onionSocket));

      this._onionSocket.pipe(split()).on("data", function (line) {
        if (line.indexOf("250-ServiceID=") === 0) {
          this._onionAddress = {
            family: 'Onion',
            address: line.substr(14) + ".onion",
            port: this._onionPort
          };
        } else if (line.indexOf("250-PrivateKey=") === 0) {
          var keyBlob = line.substr(15).trim();
          setKeyBlob(this._onionOpts.keyMaterial, keyBlob);
        } else if (line.indexOf("250 OK") === 0) {
          this.emit('listening');
        } else {
          // Unexpected condition. raise.
          this.emit('error', new Error(line));
        }
      }.bind(this));

      if (this._onionOpts.keyMaterial) {
        getKeyBlob(this._onionOpts.keyMaterial, this._onionAttach.bind(this));
      } else {
        this._onionAttach();
      }
    }.bind(this));
  }.bind(this));
};

var createServer = function (options, requestListener) {
  if (typeof options === 'function' && !requestListener) {
    requestListener = options;
    options = {};
  }
  var server = http.createServer(requestListener);
  server.listen = listen.bind(server, server.listen, options);
  return server;
};

exports.createServer = createServer;
