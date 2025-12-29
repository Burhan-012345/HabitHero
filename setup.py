#!/usr/bin/env python3
import os
import sys
from app import app, db

def setup():
    with app.app_context():
        # Create database tables
        db.create_all()
        
        # Create upload directories
        os.makedirs('uploads/snaps', exist_ok=True)
        os.makedirs('uploads/avatars', exist_ok=True)
        os.makedirs('instance', exist_ok=True)
        
        print("✅ Database tables created")
        print("✅ Upload directories created")
        
        # Create .env file if it doesn't exist
        if not os.path.exists('.env'):
            with open('.env', 'w') as f:
                f.write("""# Flask
SECRET_KEY=dev-secret-key-change-in-production
FLASK_ENV=development

# Database
DATABASE_URL=sqlite:///instance/habithero.db

# Email (for development - use MailHog)
MAIL_SERVER=localhost
MAIL_PORT=1025
MAIL_USE_TLS=False
MAIL_USE_SSL=False
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_DEFAULT_SENDER=noreply@habithero.dev
""")
            print("✅ .env file created")
        
        print("\n🎉 Setup complete! Run the app with:")
        print("python app.py")

if __name__ == '__main__':
    setup()