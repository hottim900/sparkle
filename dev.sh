#!/bin/bash
source ~/.nvm/nvm.sh
nvm use 22

npm run dev &
npm run dev:server &

wait
