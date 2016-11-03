ACE Connect Lite / ACE Direct Project

## To get started:
1. Clone this repository
1. Download and install [node.js](https://nodejs.org/en/)
1. In an elevated command prompt, run `npm install -g bower`
1. In the ACE Connect Lite/ directory, run `npm install`
1. In the ACE Connect Lite/ directory, run `bower install`
1. To start the ACE Direct node server manually, run `node adserver.js`
1. To start the ACE Connect Lite node server manually, run `node aclserver.js`
 
## Configuration:
1. Copy config.json_TEMPLATE to config.json
1. Modify these parameters:
	1. _dialaroundnums_ - The ACE Connect Lite dial around number
	1. _aclport_ - The port to use for ACE Connect Lite
	1. _adport_ - The port to use for ACE Direct
	1. _apiurl_ - The Zendesk account API URL
	1. _userid_ - The Zendesk account userid
	1. _zendesk:ticket:token_ - The Zendesk account token
	1. _proxy_ - The proxy values (if necessary) to enable access to the Zendesk API
	1. _asterisk:sip:host_ - The Asterisk hostname for ACE Connect Lite
	1. _asterisk:sip:host_ - The Asterisk hostname for ACE Connect Lite
	1. _asterisk:sip:websocket_ - Replace the hostname with the appropriate Asterisk hostname for ACE Connect Lite
	1. _asterisk:ami_ - Replace with the appropriate credentials for the ACE Connect Lite Asterisk server
	1. _asteriskAD:sip:host_ - The Asterisk hostname for ACE Direct
	1. _asteriskAD:sip:host_ - The Asterisk hostname for ACE Direct
	1. _asteriskAD:sip:websocket_ - Replace the hostname with the appropriate Asterisk hostname for ACE Direct
	1. _asteriskAD:ami_ - Replace with the appropriate credentials for the  ACE Direct Asterisk server
	1. _vrscheck_ - Replace with the URL and port number of the VRS verify function (see Provider Data Portal)
	1. _agentservice_ - Replace with the URL and port number of the Agent verify function (See Agent Data Portal)
	1. _scriptservice_ - Replace with the URL and port number of the Script Service function (see Agent Data Portal)
	1. _managementportal_ - Replace with the URL to the Management dashboard
	1. _cdrportal_ = Replace with the URL to the CDR portal

## Running:
1. ACE Direct Consumer Portal, go to: http://localhost:8005/complaint.html
1. ACE Direct CSR Portal, go to: http://localhost:8005/
1. ACE Connect Lite, go to: http://localhost:8004/
