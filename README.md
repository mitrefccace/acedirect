![](images/adsmall.png)

# ACE Direct Project  

Accessible Communications for Everyone (ACE) Direct is a Direct Video Calling (DVC) platform that enables direct calling from deaf and hard-of-hearing individuals to an American Sign Language (ASL)-trained agent within an organization's call center. The agent handles the call using a video-capable phone with real-time video connection. To demonstrate the capabilities of DVC, the FCC and CAMH have further advanced the original auto-routing POC into a call center platform for two to ten customer service representatives.

Full documentation and screenshots are here: [ACE Direct Platform Release Documentation](docs/ACE-Direct-Platform-Release-Doc-for-PR-Final-11-04-2016.pdf).

### Getting Started
To install ACE Direct, follow the README.md file in the autoinstall folder. The instructions for manual install are also provided below for reference.
1. Clone this repository
1. Download and install [Node.js](https://nodejs.org/en/)
1. In an elevated command prompt, run `npm install -g bower`
1. Install the required Node.js modules: cd into the acedirect directory, run `npm install`
1. Install the required Bower packages: cd into the acedirect directory, run `bower install`
1. To start the ACE Direct node server manually, run `node adserver.js`

### SSL Configuration
1. ACE software uses SSL which requires a valid key and certificate
1. The location of the SSL key and certificate can be specified in the config.json by using the https:certificate and https:private_key parameters in the form of folder/file (e.g., ssl/mycert.pem and ssl/mykey.pem)
1. Additional information can be found in the ACE Direct Platform Release document

### Configuration
1. The ACE Direct configuration file is _config.json_. All values in the file are hashed using Base64 encoding for protection of sensitive information. The _config.json_TEMPLATE_ file is the template.
1. Use the _Hashconfig_ tool to modify values in the config.json file. This tool is available in a separate repo.
1. The _config.json_ file includes the following parameters:
    * _clearText_ - The existence of this optional flag indicates that the config.json file is not encoded. Remove it if the file is encoded. 
    * _debuglevel_ - The debug level (ALL | TRACE | DEBUG | INFO | WARN | ERROR | FATAL | OFF)
    * _https:adport_ - The port to use for ACE Direct
    * _https:certificate_ - The path to the certificate file
    * _https:private_key_ - The path to the private key file
    * _zendesk:apiurl_ - The Zendesk account API URL
    * _zendesk:userid_ - The Zendesk account userid
    * _zendesk:token_ - The Zendesk account token
    * _asteriskAD:sip:public_ - Hostname or IP address of the ACE Direct Asterisk instance
    * _asteriskAD:sip:local_ - Local IP address for the ACE Direct Asterisk instance
    * _asteriskAD:sip:stun_ - Replace the hostname with the appropriate Asterisk hostname for ACE Direct
    * _asteriskAD:sip:wsport_ - WSS port for the ACE Direct Asterisk instance    
    * _asteriskAD:ami:id_ - Username for the ACE Direct Asterisk server
    * _asteriskAD:ami:passwd_ - Password for the ACE Direct Asterisk server
    * _asteriskAD:ami:port_ - AMI listen port number for the ACE Direct Asterisk server
    * _extensions:startnumber_ - Starting Asterisk extension number used by consumer portal(s) - e.g. 90001
    * _extensions:endnumber_ - Ending Asterisk extension number used by consumer portal(s) - e.g. 90005
    * _extensions:secret_ - Password used by the consumer portal(s) when connecting to Asterisk
    * _queues:complaint:number_ - Phone number associated with the complaints queue
    * _queues:videomail:number_ - Phone number associated with the videomail queue
    * _queues:videomail:maxrecordsecs_ - Maximum length in seconds of a videomail recording    
    * _vrscheck:url_ - Replace with the URL of the VRS verify function (see Provider Data Portal)
    * _vrscheck:port_ - Replace with the port number of the VRS verify function (see Provider Data Portal)
    * _agentservice:url_ - Replace with the URL of the Agent verify function (See Agent Data Portal)
    * _agentservice:port_ - Replace with the port number of the Agent verify function (See Agent Data Portal)
    * _scriptservice:url_ - Replace with the URL of the Script Service function (see Agent Data Portal)
    * _scriptservice:port_ - Replace with the port number of the Script Service function (see Agent Data Portal)
    * _managementportal:assistance_ - Replace with the URL to the agent assist dashboard
    * _redis:host_ - Redis server IP address    
    * _redis:auth_ - Redis server authentication token    
    * _redis:port_ - Redis server port number        
    * _jsonwebtoken:encoding_ - Encoding scheme
    * _jsonwebtoken:secretkey_ - Secret key used for authentication/tokeb signing
    * _jsonwebtoken:timeout_ - Token timeout in ms,connection must be established before timeout
    * _jsonwebtoken:handshake_ - Boolean that indicates if token is accessible in the handshake
    * _session:secretKey_ -     
    * _session:resave_ -     
    * _session:saveUninitialized_ -     
    * _session:secure_ -     
    * _session:httpOnly_ -     
    * _session:rolling_ -     
    * _session:maxAge_ -         
    * _openam:serverUrl_ - URL of OAM server
    * _openam:privateIP_ - local IP address of OAM server
    * _openam:port_ - port number of OAM server
    * _openam:domain_ - domain of OAM server
    * _openam:path_ - unique path string for OAM server URL    
    * _virtualagent:mysql:host_ - 
    * _virtualagent:mysql:user_ - 
    * _virtualagent:mysql:password_ - 
    * _virtualagent:mysql:database_ - 
    * _virtualagent:mysql:port_ - 
    * _virtualagent:mysql:table_ - 
    * _complaintredirect:active_ - "true" or "false"; whether or not the complaint form redirects consumers after a call
    * _complaintredirect:desc_ - Description of page to redirect to
    * _complaintredirect:url_ - URL of page to redirect to

### Accessing the Portals
1. ACE Direct Consumer Portal, go to: https://host/ACEDirect/complaint
1. ACE Direct Customer Service Rep (CSR) Portal, go to: https://host/ACEDirect/agent
