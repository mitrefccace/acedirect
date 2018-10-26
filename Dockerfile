FROM node:8-alpine

WORKDIR /usr/src/app

RUN if [ -n "$http_proxy" ]; then export https_proxy=$http_proxy ; \
    echo "{ \"proxy\": \"$http_proxy\", \"https-proxy\":\"$http_proxy\" }" > ~/.bowerrc  ; \
        npm config set proxy $http_proxy ;\
        npm config set https-proxy $http_proxy; fi

COPY package.json .
COPY bower.json .

RUN apk update && apk add git bash curl

ENV DOCKERIZE_VERSION v0.6.1
RUN curl -kL -O https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz \
    && tar -C /usr/local/bin -xzvf dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz \
    && rm dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz

COPY . .
#RUN npm install && npm install -g bower pm2 &&  bower install --quiet --allow-root
RUN npm install && npm install -g bower pm2 &&  bower install --allow-root

EXPOSE 8005 

ENTRYPOINT ["./docker-entrypoint.sh"]
####RUN apk add node && npm install pm2 -g
#CMD [ "pm2-docker", "start", "adserver.js" ]
# Start pm2.json process file
#CMD ["pm2-runtime", "start", "pm2.json"]
