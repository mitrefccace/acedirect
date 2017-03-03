rm -f nohup.out
#nohup node server.js > nohup.out
pm2 start --merge-logs -l logs/server.log process.json 
#tail -f nohup.out

