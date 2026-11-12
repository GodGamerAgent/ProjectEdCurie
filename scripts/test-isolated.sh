#!/usr/bin/env bash
set -euo pipefail
work="$(mktemp -d "${TMPDIR:-/tmp}/edcurie-test.XXXXXX")"
cleanup() {
  pg_ctl -D "$work/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
port="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
initdb -D "$work/data" --auth=trust --no-instructions >/dev/null
pg_ctl -D "$work/data" -o "-h 127.0.0.1 -p $port -k $work" -l "$work/postgres.log" start >/dev/null
createdb -h 127.0.0.1 -p "$port" -U "$(id -un)" edcurie_test
export DATABASE_URL="postgresql://$(id -un)@127.0.0.1:$port/edcurie_test"
export TEST_DATABASE_URL="$DATABASE_URL"
npm run db:migrate
npm test
