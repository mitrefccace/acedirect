![](images/acedirectsmall.png)

# ACE Direct Project

Accessible Communications for Everyone (ACE) Direct is a Direct Video Calling (DVC) platform that enables direct calling from deaf and hard-of-hearing individuals to an American Sign Language (ASL)-trained agent in an organization's call center. The agent handles the call using a video-capable phone with a real-time video connection. To demonstrate the capabilities of DVC, the Federal Communications Commission (FCC) and CMS Alliance to Modernize Healthcare (CAMH) have further advanced the original auto-routing proof-of-concept into a call center platform for two to ten customer service representatives.

Full documentation and screenshots are here: [ACE Direct Platform Release Documentation](docs/ACE-Direct-Platform-Release-Doc-for-PR-Final-11-04-2016.pdf).

### Getting Started
Probably the *best* way to install the entire ACE Direct system is to start with the acedirect-public repo. Follow the documentation there for a clean install. The CHECKLISTS.md file provides an overview of the complete installation and configuration process.

To manually install just the ACE Direct server:
1. Clone this repository
1. Clone the dat repo in the same folder and follow the configuration instructions.
1. Download and install [Node.js](https://nodejs.org/en/)
1. In an elevated command prompt, run `npm install -g bower`
1. Run the required build script: cd into the acedirect directory, run `npm run build`
1. To start the ACE Direct node server manually, run `node adserver.js`

### SSL Configuration
1. ACE software uses SSL which requires a valid key and certificate
1. The location of the SSL key and certificate is specified in the dat/config.json file with the common:https:certificate and common:https:private_key parameters in the form of full-path/file (e.g., /home/centos/ssl/mycert.pem and /home/centos/ssl/mykey.pem)
1. Additional information can be found in the ACE Direct Platform Release document

### Accessing the Portals
1. ACE Direct Consumer Portal: https://host/ACEDirect/complaint
1. ACE Direct Customer Service Rep (CSR) Portal: https://host/ACEDirect/agent

