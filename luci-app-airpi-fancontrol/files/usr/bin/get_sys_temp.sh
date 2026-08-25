#!/bin/sh
# Compatibility wrapper. Temperature discovery is implemented by Rust.
case "$1" in ""|-a|-c|-s) exec /usr/bin/airpi-fanctl legacy-temp "$1" ;; esac
echo "usage: get_sys_temp.sh [-a|-c|-s]" >&2
exit 1
