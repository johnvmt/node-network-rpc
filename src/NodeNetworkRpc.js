var Rpc = require('agnostic-rpc');
var EventEmitter = require('wolfy87-eventemitter');
var QueueEmitter = require('queue-emitter');
var AgnosticRouter = require('agnostic-router');
var NodeNetwork = require('node-network');
var Utils = require('./Utils.js');

function NodeNetworkRpc(config) {
	var rpc = this;
	rpc.connected = false;

	rpc._queueEmitter = new QueueEmitter();

	// TODO separate configs
	rpc.network = NodeNetwork(config);
	rpc.router = AgnosticRouter();
	rpc._rpc = Rpc();

	rpc.network.on('message', function(message) {
		rpc._rpcMessage(message);
	});

	rpc.network.on('address', function(address) {
		rpc.address = address;
		if(typeof address == 'undefined') {
			rpc.connected = false;
			rpc.emit('disconnect');
		}
		else {
			rpc.connected = true;
			rpc.emit('connect');
		}
	});

	['insert', 'remove'].forEach(function(eventType) {
		rpc.network.on(eventType, function() {
			rpc.emit(eventType, Array.prototype.slice.call(arguments));
		});
	});

	var configDefaults = {

	};

	this.config = Utils.objectMerge(configDefaults, config);
}

NodeNetworkRpc.prototype.__proto__ = EventEmitter.prototype;

/**
 * Pass calls to queue emitter
 */
NodeNetworkRpc.prototype.queueOn = function() {
	this._queueEmitter.on.apply(this._queueEmitter, Array.prototype.slice.call(arguments));
};

/**
 * Pass calls to queue emitter
 */
NodeNetworkRpc.prototype.queueOnce = function() {
	this._queueEmitter.once.apply(this._queueEmitter, Array.prototype.slice.call(arguments));
};

NodeNetworkRpc.prototype.request = function() {
	// TODO queue if no address set?

	var nnrpc = this;

	if(typeof nnrpc.address == 'undefined')
		throw new Error('NO ADDRESS SET');

	var parsedArgs = Utils.parseArgs(
		arguments,
		[
			{name: 'destAddresses', level: 1,  validate: function(arg, allArgs) { return ((typeof arg == 'string' && arg[0] != '/') || Array.isArray(arg)); }},
			{name: 'path', level: 0,  validate: function(arg, allArgs) { return typeof arg == 'string' && arg[0] == '/'; }},
			{name: 'query', level: 1,  validate: function(arg, allArgs) { return typeof arg == 'object'; }, default: {}},
			{name: 'options', level: 2,  validate: function(arg, allArgs) { return typeof arg == 'object'; }, default: {}},
			{name: 'callback', level: 1,  validate: function(arg, allArgs) { return typeof(arg) === 'function'; }}
		]
	);

	// Build rpc request message object and set the return address
	var rpcRequest = {
		query: {
			path: parsedArgs.path,
			query: parsedArgs.query,
			srcAddress: this.address
		},
		options: parsedArgs.options
	};

	// Set response handler
	if(typeof parsedArgs.callback == 'function') { // Request expects a response
		rpcRequest.responseHandler = function(rpcError, rpcResponse) {
			if(typeof parsedArgs.callback == 'function') {
				if(rpcError) // Error in RPC request
					parsedArgs.callback(rpcError);
				else if(typeof rpcResponse != 'object') // Response not of the right type
					parsedArgs.callback('response_not_object');
				else // Pass error and response to callback
					parsedArgs.callback(rpcResponse.error, rpcResponse.response);
			}
		}
	}
	else // No response expected
		rpcRequest.responseHandler = undefined;

	// Set destination
	// TODO add default destination
	rpcRequest.destAddresses = nnrpc.network.normalizeAddresses(parsedArgs.destAddresses); // Convert to Array

	nnrpc._queueEmitter.emit('outgoingRequest', rpcRequest, function(error) {
		if(error) {
			if(typeof rpcRequest.responseHandler == 'function')
				rpcRequest.responseHandler(error);
		}
		else {
			var rpcRequestMessage = nnrpc._rpc.request(rpcRequest.query, rpcRequest.options, rpcRequest.responseHandler);
			nnrpc.network.send(rpcRequest.destAddresses, rpcRequestMessage);
		}
	});
};

NodeNetworkRpc.prototype._rpcMessage = function(rpcMessage) {
	var nnrpc = this;
	if(nnrpc._rpc.messageIsResponse(rpcMessage)) { // incoming response
		nnrpc._queueEmitter.emit('incomingResponse', rpcMessage, function(error) {
			nnrpc._rpc.handleResponse(rpcMessage);
		});
	}
	else { // incoming request
		nnrpc._queueEmitter.emit('incomingRequest', rpcMessage, function(error) {
			var destAddress = undefined;

			var requestHandler = function(requestMessage, respond) {
				destAddress = requestMessage.srcAddress; // return responses to src

				// TODO get response address from message, use DNS addresses

				var packResponse = function(error, response) {
					respond({
						error: error,
						response: response
					});
				};

				var noRouteHandler = function() {
					packResponse('not_found', null);
				};

				// Send request into the URL router
				nnrpc.router.route('request', requestMessage.path, {query: requestMessage.query}, packResponse, noRouteHandler);
			};

			var responseEmitter = function(responseMessage) {

				var rpcResponse = {
					destAddress: destAddress,
					message: responseMessage
				};

				// Respond to the src address
				nnrpc._queueEmitter.emit('outgoingResponse', rpcResponse, function(error) {
					if(!error)
						nnrpc.network.send(rpcResponse.destAddress, rpcResponse.message);
				});
			};

			nnrpc._rpc.handleRequest(rpcMessage, requestHandler, responseEmitter);
		});
	}
};

NodeNetworkRpc.prototype.addConnection = function(connection) {
	this.network.addConnection.apply(this.network, Array.prototype.slice.call(arguments));
};

module.exports = function(config) {
	return new NodeNetworkRpc(config);
};
