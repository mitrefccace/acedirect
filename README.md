# ACE Direct

![ACE Direct](images/acedirectsmall.png)

This repo is for the main `acedirect` server.

Accessible Communications for Everyone (ACE) Direct is a Direct Video Calling (DVC) platform that enables direct calling from deaf and hard-of-hearing individuals to an American Sign Language (ASL)-trained agent in an organization's call center. The agent handles the call using a video-capable phone with a real-time video connection. To demonstrate the capabilities of DVC, the Federal Communications Commission (FCC) and CMS Alliance to Modernize Healthcare (CAMH) have further advanced the original auto-routing proof-of-concept into a call center platform for two to ten customer service representatives.

ACE Direct Platform Release documentation and screenshots are in the [docs](docs) folder.

## Getting Started

To install the entire ACE Direct system, clone the `acedirect-public` repo. Follow the documentation there for a clean install. The `CHECKLISTS.md` file provides an overview of the complete installation and configuration process.

To manually install just the `acedirect` server:

1. Clone this repository
1. Clone the `dat` repo in the same folder and follow its configuration instructions.
1. Download and install [Node.js](https://nodejs.org/en/)

## SSL Configuration

1. ACE software uses SSL which requires a valid key and certificate
1. The location of the SSL key and certificate is specified in the `dat/config.json` file with the `common:https:certificate` and `common:https:private_key` parameters in the form of full-path/file (e.g., `/home/centos/ssl/mycert.pem` and `/home/centos/ssl/mykey.pem`)
1. Additional information can be found in the ACE Direct Platform Release document

## Building and deploying

```shell
$  cd acedirect
$  npm install -g gulp-cli  # may require root privileges
$  npm run build
$
$  node adserver.js  # run the server manually
```

## Accessing the Portals

Depending on your configuration, use the following URLs to access the ACE Direct portal:

1. ACE Direct Consumer Portal: `https://host/ACEDirect/complaint`
1. ACE Direct Customer Service Rep (CSR) portal: `https://host/ACEDirect/agent`

