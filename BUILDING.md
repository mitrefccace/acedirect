# acedirect repo


## Building

```shell
$  rm -rf node_modules
$  npm install
$  npm run build
```

## Deploying


```shell
$  pm2 stop all
$  pm2 start all
$  pm2 start dat/process.json  # if first time
```

