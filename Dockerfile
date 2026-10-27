FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production
WORKDIR /app
COPY requirements-online.txt ./
RUN pip install --no-cache-dir -r requirements-online.txt && useradd --create-home --uid 10001 release
COPY checklist_tool.py storage_utils.py board_template.html board.js board.css permission_profiles.json permission_rules.json permission_visibility.js permission_visibility.py ./
COPY online ./online
USER release
EXPOSE 8000
CMD ["sh", "-c", "exec gunicorn 'online.app:create_app()' --bind 0.0.0.0:${PORT:-8000} --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile -"]
