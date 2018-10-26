#!/bin/sh

DIR=/usr/src/dat/; export DIR

#OPENAM_IP=`nslookup openam | grep -oE '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'`; export OPENAM_IP
#NGINX_IP=`nslookup nginx | grep -oE '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'`; export NGINX_IP

#cp $DIR/config.json.tmp $DIR/config.json

#sed -i -e "s/<OPENAM_IP>/$OPENAM_IP/g" $DIR/config.json
#sed -i -e "s/<NGINX_IP>/$NGINX_IP/g" $DIR/config.json
#sed -i -e "s/<HOSTNAME>/$HOSTNAME/g" $DIR/config.json

if [ -r $DIR/config.json ]; then
    # dockerize -wait tcp:
	pm2-docker start adserver.js
else
	echo "error: unable to read ${DIR}config.json file."
fi
