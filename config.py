# config.py
import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Basic
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    
    # Database - Simplified path (will create in current directory)
    basedir = os.path.abspath(os.path.dirname(__file__))
    db_path = os.path.join(basedir, 'hero.db')
    SQLALCHEMY_DATABASE_URI = f'sqlite:///{db_path}'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # config.py - Add these lines
    WTF_CSRF_ENABLED = True
    WTF_CSRF_SECRET_KEY = os.environ.get('CSRF_SECRET_KEY') or 'csrf-secret-key-change-in-production'

    MAIL_SERVER = 'smtp.gmail.com'
    MAIL_PORT = 587
    MAIL_USE_TLS = True
    MAIL_USE_SSL = False
    MAIL_USERNAME = 'fiscalflow.service@gmail.com'
    MAIL_PASSWORD = 'pgoc apte zjyy wogn'
    MAIL_DEFAULT_SENDER = ('HabitHero', 'fiscalflow.service@gmail.com')
    MAIL_DEBUG = True
    
    # File Uploads
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size
    UPLOAD_FOLDER = os.path.join(basedir, 'uploads')
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp4', 'mov', 'avi'}
    
    # Security (Development only)
    REMEMBER_COOKIE_DURATION = timedelta(days=7)
    SESSION_PROTECTION = 'basic'
    
    # OTP Settings
    OTP_EXPIRY_MINUTES = 5
    PASSWORD_RESET_EXPIRY_MINUTES = 15
    
    # Flask-Login
    SESSION_COOKIE_SECURE = False   
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    
    # Flask-SocketIO
    SOCKETIO_ASYNC_MODE = 'threading'
    
    # Debugging
    DEBUG = True
    TESTING = False