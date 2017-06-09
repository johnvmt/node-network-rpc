var Rpc = require('agnostic-rpc');
var EventEmitter = require('wolfy87-eventemitter');
var AgnosticRouter = require('agnostic-router');
var NodeNetwork = require('node-network');
var Utils = require('./Utils.js');

function NodeNetworkRpc(config) {
	var rpc = this;

	rpc.network = NodeNetwork(config);
	rpc.router = AgnosticRouter();
	rpc._rpc = Rpc();

	rpc.network.on('message', function(message) {
		rpc._rpcMessage(message);
	});

	rpc.network.on('address', function(address) {
		rpc.address = address;
		if(typeof address == 'undefined')
			rpc.emit('disconnect');
		else
			rpc.emit('connect');
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

NodeNetworkRpc.prototype.request = function() {
	// TODO queue if no address set?

	if(typeof this.address == 'undefined')
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
	var rpcRequestQuery = {path: parsedArgs.path, query: parsedArgs.query, srcAddress: this.address};

	if(typeof parsedArgs.callback == 'function') { // Request expects a response
		var rpcResponseHandler = function(rpcError, rpcResponse) {
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
		var rpcResponseHandler = undefined;

	var rpcRequestMessage = this._rpc.request(rpcRequestQuery, parsedArgs.options, rpcResponseHandler);

	// Add destination
	if(typeof parsedArgs.destAddresses != 'string') {} // TODO add default destination
	var destAddresses = parsedArgs.destAddresses;

	this.network.send(destAddresses, rpcRequestMessage);
};

NodeNetworkRpc.prototype._rpcMessage = function(rpcMessage) {
	var rpc = this;
	if(this._rpc.messageIsResponse(rpcMessage)) // incoming response
		this._rpc.handleResponse(rpcMessage);
	else { // incoming request
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
			rpc.router.route('request', requestMessage.path, {query: requestMessage.query}, packResponse, noRouteHandler);
		};

		var responseEmitter = function(responseMessage) {
			// TODO use DNS to get real address
			// Respond to the src address
			//console.log(rpcMessage);
			rpc.network.send(destAddress, responseMessage);
		};

		this._rpc.handleRequest(rpcMessage, requestHandler, responseEmitter);
	}
};

NodeNetworkRpc.prototype.addConnection = function(connection) {
	this.network.addConnection(connection);
};

module.exports = function(config) {
	return new NodeNetworkRpc(config);
};
