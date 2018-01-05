![](images/adsmall.png)

# ACE Direct Project  

Accessible Communications for Everyone (ACE) Direct is a Direct Video Calling (DVC) platform that enables direct calling from deaf and hard-of-hearing individuals to an American Sign Language (ASL)-trained agent in an organization's call center. The agent handles the call using a video-capable phone with a real-time video connection. To demonstrate the capabilities of DVC, the Federal Communications Commission (FCC) and CMS Alliance to Modernize Healthcare (CAMH) have further advanced the original auto-routing proof-of-concept into a call center platform for two to ten customer service representatives.

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

### Accessing the Portals
1. ACE Direct Consumer Portal, go to: https://host/ACEDirect/complaint
1. ACE Direct Customer Service Rep (CSR) Portal, go to: https://host/ACEDirect/agent
