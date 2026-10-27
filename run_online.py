#!/usr/bin/env python3
"""Local preview. Production uses the Docker/Gunicorn entrypoint."""
import argparse
import getpass
import os
from pathlib import Path

parser = argparse.ArgumentParser(description='启动在线工作台的本地预览')
parser.add_argument('--port', type=int, default=8787)
args = parser.parse_args()
os.environ.setdefault('APP_ENV', 'development')
os.environ.setdefault('DATABASE_URL', 'sqlite:///' + str(Path(__file__).parent.resolve() / 'online/local.sqlite3'))
if not Path(__file__).with_name('online').joinpath('local.sqlite3').exists():
    os.environ.setdefault('ADMIN_EMAIL', input('管理员邮箱：').strip())
    os.environ.setdefault('ADMIN_PASSWORD', getpass.getpass('设置管理员密码（至少12位）：'))
from online.app import create_app
create_app().run(host='127.0.0.1',port=args.port,debug=False)
