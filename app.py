import os
import re  
import secrets
import random
import string
from sqlalchemy import event
import eventlet
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, render_template, request, jsonify, redirect, send_file, url_for, flash, send_from_directory, Response, session
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_mail import Mail, Message
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import or_, and_
import json
import mimetypes
def init_admin():
    """Initialize admin panel - defined here to avoid circular imports"""
    print("Admin panel initialized")

# Initialize extensions without app context first
db = SQLAlchemy()
bcrypt = Bcrypt()
login_manager = LoginManager()
mail = Mail()
socketio = SocketIO()

app = Flask(__name__)
app.config.from_object('config.Config')
app.config['SECRET_KEY'] = secrets.token_hex(32)

from admin import init_admin as init_admin_panel, add_admin_field_to_user, create_default_admin_user

# Print debug info
print(f"Database URI: {app.config['SQLALCHEMY_DATABASE_URI']}")

# Now initialize extensions with the app
db.init_app(app)
bcrypt.init_app(app)
login_manager.init_app(app)
login_manager.login_view = 'login'
mail.init_app(app)
socketio.init_app(app, cors_allowed_origins="*")

# Ensure upload directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], 'snaps'), exist_ok=True)
os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], 'avatars'), exist_ok=True)
os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], 'videos'), exist_ok=True)

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), nullable=False)  # Changed from unique=True to allow multiple accounts
    password_hash = db.Column(db.String(200), nullable=False)
    is_verified = db.Column(db.Boolean, default=False)
    bio = db.Column(db.Text, default='')  # Add this back
    avatar = db.Column(db.String(200), default=None)  # Add this back
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    is_online = db.Column(db.Boolean, default=False)
    is_admin = db.Column(db.Boolean, default=False)

    saved_snaps = db.relationship('SavedSnap', backref='saving_user', lazy=True)
    habits = db.relationship('Habit', backref='user', lazy=True, cascade='all, delete-orphan')
    habit_logs = db.relationship('HabitLog', backref='user', lazy=True, cascade='all, delete-orphan')
    sent_snaps = db.relationship('Snap', foreign_keys='Snap.sender_id', backref='sender', lazy=True)
    received_snaps = db.relationship('Snap', foreign_keys='Snap.receiver_id', backref='receiver', lazy=True)
    sent_friend_requests = db.relationship('Friend', foreign_keys='Friend.user_id', backref='sender', lazy=True)
    received_friend_requests = db.relationship('Friend', foreign_keys='Friend.friend_id', backref='receiver', lazy=True)
    snap_reactions = db.relationship('SnapReaction', backref='user', lazy=True)

class Habit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    frequency = db.Column(db.String(20), default='daily')
    streak_count = db.Column(db.Integer, default=0)
    best_streak = db.Column(db.Integer, default=0)
    last_completed = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    logs = db.relationship('HabitLog', backref='habit', lazy=True, cascade='all, delete-orphan')
    snaps = db.relationship('Snap', backref='habit', lazy=True)

class HabitLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    habit_id = db.Column(db.Integer, db.ForeignKey('habit.id'), nullable=False)
    completed_at = db.Column(db.DateTime, default=datetime.utcnow)
    note = db.Column(db.Text)

class Friend(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    friend_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, accepted, blocked
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user_id', 'friend_id', name='unique_friendship'),)

class Snap(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    habit_id = db.Column(db.Integer, db.ForeignKey('habit.id'), nullable=True)
    content_type = db.Column(db.String(20))  # image, video, text
    content = db.Column(db.Text)  # file path or text
    caption = db.Column(db.String(200))
    is_viewed = db.Column(db.Boolean, default=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    reactions = db.relationship('SnapReaction', backref='snap', lazy=True, cascade='all, delete-orphan')

class SnapReaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    snap_id = db.Column(db.Integer, db.ForeignKey('snap.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    emoji = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class SavedSnap(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    snap_id = db.Column(db.Integer, db.ForeignKey('snap.id'), nullable=False)
    saved_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user_id', 'snap_id', name='unique_saved_snap'),)
    
    user = db.relationship('User', backref='saved_snap_entries')
    snap = db.relationship('Snap', backref='saved_by_users')

class EmailVerificationOTP(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False)
    otp = db.Column(db.String(6), nullable=False)
    is_verified = db.Column(db.Boolean, default=False)  # Add this
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)

class PasswordResetToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    token = db.Column(db.String(100), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)

class ChatMessage(db.Model):
    __tablename__ = 'message'
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_read = db.Column(db.Boolean, default=False)
    status = db.Column(db.String(20), default='sent')

    edited = db.Column(db.Boolean, default=False)
    is_forwarded = db.Column(db.Boolean, default=False)
    original_message_id = db.Column(db.Integer, nullable=True)  
    deleted_for_sender = db.Column(db.Boolean, default=False)
    deleted_for_receiver = db.Column(db.Boolean, default=False)
    
    sender = db.relationship('User', foreign_keys=[sender_id], backref='sent_messages')
    receiver = db.relationship('User', foreign_keys=[receiver_id], backref='received_messages')

# app.py - around line 300-310, right after the Notification class definition:

class Notification(db.Model):
    __tablename__ = 'notification'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    text = db.Column(db.String(500), nullable=False)
    link = db.Column(db.String(200))
    is_read = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref='notifications')

# ================ ADD THIS SECTION RIGHT HERE ================
# Create models dictionary for admin panel
models = {
    'User': User,
    'Habit': Habit,
    'HabitLog': HabitLog,
    'Friend': Friend,
    'Snap': Snap,
    'SnapReaction': SnapReaction,
    'SavedSnap': SavedSnap,
    'EmailVerificationOTP': EmailVerificationOTP,
    'PasswordResetToken': PasswordResetToken,
    'ChatMessage': ChatMessage,
    'Notification': Notification
}

# Now initialize admin panel with models
init_admin_panel(app, db, models)
# ================ END OF ADDED SECTION ================

@login_manager.user_loader
def load_user(user_id):
    if not user_id or user_id == 'None' or user_id == 'null':
        return None
    
    try:
        return User.query.get(int(user_id))
    except (ValueError, TypeError):
        return None

# Helper Functions
def allowed_file(filename):
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'mp4', 'mov', 'webm', 'avi'}
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_file_type(filename):
    """Determine if file is image or video based on extension"""
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    if ext in ['png', 'jpg', 'jpeg', 'gif']:
        return 'image'
    elif ext in ['mp4', 'mov', 'webm', 'avi']:
        return 'video'
    return 'text'

def generate_otp():
    return ''.join(random.choices(string.digits, k=6))

def generate_reset_token():
    return secrets.token_urlsafe(32)

def validate_password(password):
    """Validate password against rules"""
    errors = []
    if len(password) < 8:
        errors.append("Password must be at least 8 characters long")
    if not any(c.isupper() for c in password):
        errors.append("Password must contain at least one uppercase letter")
    if not any(c.islower() for c in password):
        errors.append("Password must contain at least one lowercase letter")
    if not any(c.isdigit() for c in password):
        errors.append("Password must contain at least one number")
    if not any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?/" for c in password):
        errors.append("Password must contain at least one special character")
    return errors

def save_snap_file(file, user_id):
    """Save snap file with proper naming and path"""
    if not file:
        return None
    
    # Generate unique filename
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    original_filename = secure_filename(file.filename)
    filename = f"snap_{user_id}_{timestamp}_{original_filename}"
    
    # Determine file type and subdirectory
    file_type = get_file_type(original_filename)
    if file_type == 'video':
        upload_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'videos')
    else:
        upload_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'snaps')
    
    # Ensure directory exists
    os.makedirs(upload_dir, exist_ok=True)
    
    # Save file
    filepath = os.path.join(upload_dir, filename)
    file.save(filepath)
    
    # Return relative path
    if file_type == 'video':
        return f'videos/{filename}'
    else:
        return f'snaps/{filename}'
    
def check_for_duplicate_message(sender_id, receiver_id, content, time_window_seconds=2):
    """Check if a similar message was sent recently"""
    time_threshold = datetime.utcnow() - timedelta(seconds=time_window_seconds)
    
    duplicate = ChatMessage.query.filter(
        ChatMessage.sender_id == sender_id,
        ChatMessage.receiver_id == receiver_id,
        ChatMessage.content == content,
        ChatMessage.timestamp > time_threshold
    ).order_by(ChatMessage.timestamp.desc()).first()
    
    return duplicate

# Template filters - ADD THIS SECTION HERE
@app.template_filter('timesince')
def timesince_filter(dt):
    now = datetime.utcnow()
    diff = now - dt
    
    if diff.days > 365:
        years = diff.days // 365
        return f'{years} year{"s" if years > 1 else ""} ago'
    elif diff.days > 30:
        months = diff.days // 30
        return f'{months} month{"s" if months > 1 else ""} ago'
    elif diff.days > 0:
        return f'{diff.days} day{"s" if diff.days > 1 else ""} ago'
    elif diff.seconds > 3600:
        hours = diff.seconds // 3600
        return f'{hours} hour{"s" if hours > 1 else ""} ago'
    elif diff.seconds > 60:
        minutes = diff.seconds // 60
        return f'{minutes} minute{"s" if minutes > 1 else ""} ago'
    else:
        return 'just now'

@app.template_filter('enumerate')
def enumerate_filter(sequence):
    return list(enumerate(sequence))

@app.template_filter('filter_by')
def filter_by(sequence, attr_name, attr_value):
    """Filter a sequence of objects by attribute value.
    
    Usage in templates: {{ users|filter_by('is_online', true) }}
    """
    try:
        return [item for item in sequence if getattr(item, attr_name) == attr_value]
    except (AttributeError, TypeError):
        return []

# Add this template filter near other template filters (around line 1700-1800)
@app.template_filter('get_notification_icon')
def get_notification_icon(text):
    """Get appropriate icon for notification type"""
    if not text:
        return 'bell'
    
    text_lower = text.lower()
    if 'message' in text_lower or 'chat' in text_lower:
        return 'comment'
    elif 'friend' in text_lower or 'request' in text_lower:
        return 'user-plus'
    elif 'snap' in text_lower or 'camera' in text_lower:
        return 'camera'
    elif 'habit' in text_lower or 'streak' in text_lower:
        return 'fire'
    else:
        return 'bell'

@app.context_processor
def inject_context():
    if current_user.is_authenticated:
        # Count unviewed snaps
        unviewed_snaps_count = Snap.query.filter_by(
            receiver_id=current_user.id,
            is_viewed=False
        ).count()
        
        # Count pending friend requests
        pending_friend_requests = Friend.query.filter_by(
            friend_id=current_user.id,
            status='pending'
        ).count()
        
        # Count unread notifications (including chat messages)
        unread_notifications = Notification.query.filter_by(
            user_id=current_user.id,
            is_read=False
        ).count()
        
        return {
            'unviewed_snaps_count': unviewed_snaps_count,
            'pending_friend_requests': pending_friend_requests,
            'unread_notifications': unread_notifications,
            'now': datetime.utcnow()
        }
    return {}

# Routes
@app.route('/')
def home():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return redirect(url_for('intro'))

@app.route('/intro')
def intro():
    """Introduction/welcome page for new visitors"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return render_template('dashboard/intro.html', is_intro=True)  

@app.route('/login', methods=['GET', 'POST'])
def login():
    # If already logged in, go to dashboard
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        account_id = request.form.get('account_id')
        remember = True if request.form.get('remember') else False

        # STEP 1: If account_id is NOT provided → go to account selection
        if not account_id:
            if not email:
                flash('Email is required.', 'danger')
                return redirect(url_for('login'))

            accounts = User.query.filter_by(email=email).all()

            if not accounts:
                flash('No account found with this email.', 'danger')
                return redirect(url_for('login'))

            # Redirect to account selection
            return redirect(url_for('login_select', email=email))

        # STEP 2: Account-specific login
        user = User.query.filter_by(id=account_id, email=email).first()

        if not user:
            flash('Account not found.', 'danger')
            return redirect(url_for('login'))

        # STEP 3: Check password
        if not bcrypt.check_password_hash(user.password_hash, password):
            flash('Invalid password.', 'danger')
            return redirect(
                url_for('login_account_page', account_id=account_id, email=email)
            )

        # STEP 4: Check verification
        if not user.is_verified:
            flash('Please verify your email before logging in.', 'warning')
            return redirect(url_for('login'))

        # STEP 5: Login user
        login_user(user, remember=remember)

        user.last_seen = datetime.utcnow()
        user.is_online = True
        db.session.commit()

        # Optional (safe)
        session['login_email'] = email

        flash('Login successful!', 'success')
        return redirect(url_for('dashboard'))

    # GET request → show login page
    return render_template('auth/login.html')

@app.route('/login/select')
def login_select():
    """Page to select account when multiple accounts exist for an email"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    email = request.args.get('email')
    if not email:
        return redirect(url_for('login'))
    
    # Get existing accounts for this email
    existing_accounts = User.query.filter_by(email=email).all()
    
    if not existing_accounts:
        return redirect(url_for('login'))
    
    return render_template('auth/login_select.html', 
                         email=email, 
                         accounts=existing_accounts)

@app.route('/login-account/<int:account_id>')
def login_account_page(account_id):
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    email = request.args.get('email')
    if not email:
        return redirect(url_for('login'))

    account = User.query.filter_by(id=account_id, email=email).first()
    if not account:
        flash('Account not found.', 'danger')
        return redirect(url_for('login'))

    return render_template(
        'auth/login_account.html',
        email=email,
        account=account
    )

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        email = request.form.get('email')
        username = request.form.get('username')

        if not email or not username:
            flash('Email and username are required.', 'danger')
            return redirect(url_for('register'))

        if User.query.filter_by(username=username).first():
            flash('Username already taken.', 'danger')
            return redirect(url_for('register'))

        # Save registration context
        session['reg_email'] = email
        session['reg_username'] = username

        # Go directly to create account page
        return redirect(url_for('create_account_page'))

    return render_template('auth/register.html')

@app.route('/register/complete')
def register_complete():
    """Handle post-verification account selection or creation"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    email = session.get('reg_email')
    if not email:
        return redirect(url_for('register'))
    
    # Check if OTP was verified
    otp_record = EmailVerificationOTP.query.filter_by(email=email).first()
    if not otp_record:
        flash('Please verify your email first.', 'warning')
        return redirect(url_for('register'))
    
    # Check for existing accounts
    existing_accounts = User.query.filter_by(email=email).all()
    
    return render_template('auth/register_complete.html', 
                         email=email, 
                         accounts=existing_accounts)

@app.route('/create-account-page')
def create_account_page():
    """Create account page - handles both registration and login flows"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    # Get email from wherever it's stored
    email = session.get('reg_email') or request.args.get('email')
    
    if not email:
        return redirect(url_for('register'))
    
    # Check if this is the first account for this email
    existing_accounts = User.query.filter_by(email=email).count()
    
    # If it's the first account, ensure OTP verification was completed
    if existing_accounts == 0:
        otp_record = EmailVerificationOTP.query.filter_by(email=email).first()
        if not otp_record:
            # No OTP record - redirect to verification
            flash('Please verify your email first.', 'warning')
            return redirect(url_for('register'))
    
    # All good - show create account page
    return render_template(
        'auth/create_account.html',
        email=email
    )

@app.route('/create-account-from-login')
def create_account_page_from_login():
    """Create account page when coming from login flow"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    email = request.args.get('email')
    if not email:
        flash('Email is required to create a new account.', 'danger')
        return redirect(url_for('login'))
    
    existing_accounts = User.query.filter_by(email=email).count()
    if existing_accounts >= 10:
        flash('Maximum of 10 accounts per email address reached.', 'danger')
        return redirect(url_for('login_select', email=email))
    
    session['reg_email'] = email
    
    return render_template(
        'auth/create_account.html',
        email=email
    )

@app.route('/create-account', methods=['POST'])
def create_account():
    try:
        data = request.get_json()
        email = data.get('email')
        username = data.get('username')
        password = data.get('password')
        
        print(f"🔍 Create account request:")
        print(f"   Email: {email}")
        print(f"   Username: {username}")
        
        if not email or not username or not password:
            return jsonify({'success': False, 'message': 'Missing data'})
        
        # Validate username format
        if len(username) < 3 or len(username) > 20:
            return jsonify({'success': False, 'message': 'Username must be 3-20 characters'})
        
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            return jsonify({'success': False, 'message': 'Username can only contain letters, numbers, and underscores'})
        
        # Check if username already exists
        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            return jsonify({'success': False, 'message': 'Username already taken'})
        
        # Check if email already has 10 accounts (max limit)
        existing_accounts = User.query.filter_by(email=email).count()
        if existing_accounts >= 10:
            return jsonify({'success': False, 'message': 'Maximum of 10 accounts per email address reached'})
        
        # Validate password
        errors = validate_password(password)
        if errors:
            return jsonify({'success': False, 'message': errors[0]})
        
        # ✅ FIXED: Check OTP verification status
        if existing_accounts == 0:
            # First account needs OTP verification
            print(f"📊 Checking OTP verification for {email}")
            print(f"   Existing accounts: {existing_accounts} (first account)")
            
            # Check if OTP was verified (look for verified record)
            otp_record = EmailVerificationOTP.query.filter_by(email=email).first()
            
            if not otp_record:
                print(f"❌ No OTP record found for {email}")
                return jsonify({'success': False, 'message': 'Email not verified. Please verify your email first.'})
            
            # Check if OTP is verified
            if not otp_record.is_verified:
                print(f"❌ OTP not verified for {email}")
                # Also check if OTP has expired
                if datetime.utcnow() > otp_record.expires_at:
                    db.session.delete(otp_record)
                    db.session.commit()
                    return jsonify({'success': False, 'message': 'Verification expired. Please request a new OTP.'})
                return jsonify({'success': False, 'message': 'Email not verified. Please verify your email first.'})
            
            print(f"✅ OTP verified for {email}")
            
            # Clean up OTP record after successful account creation
            db.session.delete(otp_record)
        
        # Generate password hash
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        
        # Create user
        user = User(
            email=email,
            username=username,
            password_hash=hashed_password,
            is_verified=True  # Always verified since email is confirmed
        )
        
        db.session.add(user)
        db.session.commit()
        
        print(f"✅ User created: {username} ({email})")
        
        # Login the user after creating account
        login_user(user)
        
        # Cleanup session data
        session.pop('reg_email', None)
        session.pop('reg_username', None)
        session.pop('verified_email', None)
        session.pop('otp_verified', None)
        
        # Update user status
        user.last_seen = datetime.utcnow()
        user.is_online = True
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Account created successfully!',
            'redirect': url_for('dashboard')
        })
        
    except Exception as e:
        print(f"❌ Error creating account: {e}")
        import traceback
        traceback.print_exc()
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Server error. Please try again.'})

@app.route('/select-account')
def select_account():
    """Page to select existing account or create new one"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    email = session.get('reg_email')
    if not email:
        return redirect(url_for('register'))
    
    existing_accounts = User.query.filter_by(email=email).all()
    
    return render_template('auth/select_account.html', 
                         email=email, 
                         accounts=existing_accounts,
                         can_create_new=len(existing_accounts) < 10)

@app.route('/create-account-form')
def create_account_form():
    """Serve the create account form page"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    email = session.get('reg_email')
    username = session.get('reg_username')
    
    if not email or not username:
        return redirect(url_for('register'))
    
    return render_template('auth/create_account.html',
                         email=email,
                         username=username)

@app.route('/login-account/<int:account_id>')
def login_account(account_id):
    """Direct login to existing account"""
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    email = session.get('reg_email')
    if not email:
        return redirect(url_for('register'))
    
    # Verify the account belongs to this email
    account = User.query.filter_by(id=account_id, email=email).first()
    if not account:
        flash('Account not found.', 'danger')
        return redirect(url_for('select_account'))
    
    # Show login form for this account
    return render_template('auth/login_account.html', 
                         email=email, 
                         account=account)

@app.route('/verify-email', methods=['POST'])
def verify_email():
    try:
        data = request.get_json()
        email = data.get('email')
        username = data.get('username')
        
        print(f"📧 Verify email request for: {email}, username: {username}")
        
        if not email or not username:
            return jsonify({'success': False, 'message': 'Email and username are required'})
        
        # Validate email format
        import re
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return jsonify({'success': False, 'message': 'Invalid email format'})
        
        # Check if username already exists
        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            return jsonify({'success': False, 'message': 'Username already taken'})
        
        # Check if email has too many accounts
        existing_accounts = User.query.filter_by(email=email).count()
        if existing_accounts >= 10:
            return jsonify({'success': False, 'message': 'Maximum of 10 accounts per email address reached'})
        
        # Generate OTP
        otp = generate_otp()
        expiry = datetime.utcnow() + timedelta(minutes=app.config['OTP_EXPIRY_MINUTES'])
        
        print(f"🔢 Generated OTP: {otp} for {email}")
        print(f"⏰ Expires at: {expiry}")
        
        # Clean up old OTPs for this email
        EmailVerificationOTP.query.filter_by(email=email).delete()
        
        # Store new OTP
        otp_record = EmailVerificationOTP(
            email=email, 
            otp=otp, 
            expires_at=expiry,
            is_verified=False
        )
        db.session.add(otp_record)
        db.session.commit()
        
        print(f"💾 OTP saved to database for {email}")
        
        # Send email
        email_sent = send_verification_email(email, otp)
        
        if email_sent:
            return jsonify({
                'success': True, 
                'message': 'Verification code sent to your email!',
                'email': email,
                'otp': otp  # Include for debugging
            })
        else:
            # Still return success but with OTP shown
            return jsonify({
                'success': True, 
                'message': f'Email failed. Use OTP: {otp}',
                'email': email,
                'otp': otp,
                'debug': True
            })
            
    except Exception as e:
        print(f"❌ Error in verify_email: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': 'Server error. Please try again.'}), 500
    
@app.route('/debug/otp-status')
def debug_otp_status():
    """Debug endpoint to check OTP records"""
    email = request.args.get('email')
    if not email:
        return "Email parameter required", 400
    
    otp_records = EmailVerificationOTP.query.filter_by(email=email).all()
    
    result = f"OTP Records for {email}: {len(otp_records)} found\n\n"
    for record in otp_records:
        result += f"ID: {record.id}\n"
        result += f"OTP: {record.otp}\n"
        result += f"Created: {record.created_at}\n"
        result += f"Expires: {record.expires_at}\n"
        result += f"Verified: {record.is_verified}\n"
        result += f"Expired: {'YES' if datetime.utcnow() > record.expires_at else 'NO'}\n"
        result += "-" * 40 + "\n"
    
    return f"<pre>{result}</pre>"

@app.route('/verify-otp', methods=['POST'])
def verify_otp():
    try:
        data = request.get_json()
        email = data.get('email')
        otp = data.get('otp')
        
        print(f"🔍 OTP Verification Request:")
        print(f"   Email: {email}")
        print(f"   OTP entered: {otp}")
        
        if not email or not otp:
            print("❌ Missing email or OTP")
            return jsonify({'success': False, 'message': 'Email and OTP are required'}), 400
        
        # Find ALL OTP records for this email (for debugging)
        all_otps = EmailVerificationOTP.query.filter_by(email=email).all()
        print(f"📊 Found {len(all_otps)} OTP records for {email}")
        
        for record in all_otps:
            print(f"   - OTP: {record.otp}, Expires: {record.expires_at}, Verified: {record.is_verified}")
        
        # Find the most recent valid OTP
        otp_record = EmailVerificationOTP.query.filter_by(
            email=email,
            otp=otp
        ).order_by(EmailVerificationOTP.created_at.desc()).first()
        
        if not otp_record:
            print(f"❌ No OTP record found for {email} with code {otp}")
            return jsonify({'success': False, 'message': 'Invalid OTP'})
        
        print(f"✅ Found OTP record: {otp_record.otp}")
        print(f"   Created: {otp_record.created_at}")
        print(f"   Expires: {otp_record.expires_at}")
        print(f"   Current time: {datetime.utcnow()}")
        
        # Check if OTP is expired
        if datetime.utcnow() > otp_record.expires_at:
            print(f"⏰ OTP expired at {otp_record.expires_at}")
            # Clean up expired OTP
            db.session.delete(otp_record)
            db.session.commit()
            return jsonify({'success': False, 'message': 'OTP expired. Please request a new one.'})
        
        # Mark as verified
        otp_record.is_verified = True
        db.session.commit()
        
        # Store in session
        session['verified_email'] = email
        session['otp_verified'] = True
        
        print(f"✅ OTP verified successfully for {email}")
        
        # Check if user has existing accounts
        existing_accounts = User.query.filter_by(email=email).all()
        print(f"📊 Existing accounts for {email}: {len(existing_accounts)}")
        
        response_data = {
            'success': True, 
            'message': 'Email verified successfully!',
            'has_existing_accounts': len(existing_accounts) > 0,
            'account_count': len(existing_accounts)
        }
        
        # If no existing accounts, redirect to create account page
        if len(existing_accounts) == 0:
            response_data['redirect'] = url_for('create_account_page')
        
        return jsonify(response_data)
        
    except Exception as e:
        print(f"❌ Error in verify_otp: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': 'Server error. Please try again.'}), 500

@app.route('/api/check-existing-accounts')
def check_existing_accounts():
    """Check if email has existing accounts"""
    email = request.args.get('email')
    
    if not email:
        return jsonify({'success': False, 'message': 'Email required'})
    
    existing_accounts = User.query.filter_by(email=email).count()
    
    return jsonify({
        'success': True,
        'hasExistingAccounts': existing_accounts > 0,
        'count': existing_accounts
    })

@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        email = request.form.get('email')
        account_id = request.form.get('account_id')  # For multiple accounts
        username = request.form.get('username')  # For multiple accounts
        
        if not email:
            flash('Email is required.', 'danger')
            return redirect(url_for('forgot_password'))
        
        # Get all accounts with this email
        accounts = User.query.filter_by(email=email).all()
        
        if not accounts:
            # Don't reveal if email exists or not (security best practice)
            flash('If an account exists with that email, a reset link has been sent.', 'info')
            return redirect(url_for('login'))
        
        # Handle multiple accounts
        if len(accounts) > 1:
            # If no account_id provided, show account selection
            if not account_id:
                flash('Please select which account to reset.', 'danger')
                return redirect(url_for('forgot_password', email=email))
            
            # Verify account_id belongs to this email
            try:
                account_id_int = int(account_id)
                user = User.query.filter_by(id=account_id_int, email=email).first()
                
                if not user:
                    flash('Selected account not found for this email.', 'danger')
                    return redirect(url_for('forgot_password', email=email))
            except (ValueError, TypeError):
                flash('Invalid account selection.', 'danger')
                return redirect(url_for('forgot_password', email=email))
        
        elif len(accounts) == 1:
            # Single account
            user = accounts[0]
        
        else:
            # No accounts (shouldn't happen based on earlier check)
            flash('No account found with this email.', 'danger')
            return redirect(url_for('forgot_password'))
        
        # Generate reset token
        token = generate_reset_token()
        expiry = datetime.utcnow() + timedelta(minutes=app.config['PASSWORD_RESET_EXPIRY_MINUTES'])
        
        # Clear any existing reset tokens for this user
        PasswordResetToken.query.filter_by(user_id=user.id).delete()
        
        # Create new reset token
        reset_token = PasswordResetToken(
            user_id=user.id, 
            token=token, 
            expires_at=expiry
        )
        db.session.add(reset_token)
        db.session.commit()
        
        # Send password reset email with username
        try:
            send_password_reset_email(user.email, token, user.username)
            flash('If an account exists with that email, a reset link has been sent.', 'info')
        except Exception as e:
            print(f"Error sending password reset email: {e}")
            flash('Failed to send reset email. Please try again.', 'danger')
            return redirect(url_for('forgot_password', email=email))
        
        return redirect(url_for('login'))
    
    # GET request - show form
    email = request.args.get('email', '')
    
    accounts = []
    if email:
        accounts = User.query.filter_by(email=email).all()
    
    return render_template('auth/forgot_password.html', email=email, accounts=accounts)

@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    reset_token = PasswordResetToken.query.filter_by(token=token).first()
    
    if not reset_token or datetime.utcnow() > reset_token.expires_at:
        flash('Invalid or expired reset token.', 'danger')
        return redirect(url_for('forgot_password'))
    
    user = User.query.get(reset_token.user_id)
    
    if request.method == 'POST':
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        
        if password != confirm_password:
            flash('Passwords do not match.', 'danger')
            return redirect(url_for('reset_password', token=token))
        
        errors = validate_password(password)
        if errors:
            flash(errors[0], 'danger')
            return redirect(url_for('reset_password', token=token))
        
        # Update password
        user.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
        
        # Invalidate token
        db.session.delete(reset_token)
        db.session.commit()
        
        flash('Password updated successfully! Please login with your new password.', 'success')
        return redirect(url_for('login'))
    
    return render_template('auth/reset_password.html', token=token, username=user.username)

@app.route('/dashboard')
@login_required
def dashboard():
    # Get user's habits for today
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    
    # Get recent snaps (last 24 hours)
    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)
    recent_snaps = Snap.query.filter_by(receiver_id=current_user.id)\
        .filter(Snap.created_at >= twenty_four_hours_ago)\
        .order_by(Snap.created_at.desc())\
        .limit(5)\
        .all()
    
    # Get friend activity
    friends = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    friend_ids = []
    for friend in friends:
        if friend.user_id == current_user.id:
            friend_ids.append(friend.friend_id)
        else:
            friend_ids.append(friend.user_id)
    
    friend_activity = []
    if friend_ids:
        friend_activity = Snap.query.filter(Snap.sender_id.in_(friend_ids))\
            .filter(Snap.created_at >= twenty_four_hours_ago)\
            .order_by(Snap.created_at.desc())\
            .limit(10)\
            .all()
    
    # Get pending friend requests (as list)
    pending_requests_list = Friend.query.filter_by(
        friend_id=current_user.id,
        status='pending'
    ).all()
    
    # Get count of pending requests
    pending_requests_count = len(pending_requests_list)
    
    # Get unviewed snaps
    unviewed_snaps = Snap.query.filter_by(
        receiver_id=current_user.id,
        is_viewed=False
    ).count()
    
    # Get today's habit completions
    today = datetime.utcnow().date()
    today_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        db.func.date(HabitLog.completed_at) == today
    ).count()
    
    # Get total completions this week
    week_ago = datetime.utcnow() - timedelta(days=7)
    weekly_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.completed_at >= week_ago
    ).count()
    
    # Calculate stats
    total_habits = len(habits)
    total_streak = sum(h.streak_count for h in habits)
    active_streaks = len([h for h in habits if h.streak_count > 0])
    
    return render_template('dashboard/index.html', 
                         habits=habits, 
                         recent_snaps=recent_snaps,
                         friend_activity=friend_activity,
                         pending_requests=pending_requests_list,  # Now a list
                         pending_requests_count=pending_requests_count,  # Added count
                         unviewed_snaps=unviewed_snaps,
                         today_completions=today_completions,
                         weekly_completions=weekly_completions,
                         total_habits=total_habits,
                         total_streak=total_streak,
                         active_streaks=active_streaks,
                         today=today.strftime('%Y-%m-%d'))

@app.route('/notifications')
@login_required
def notifications_page():
    """Notifications page"""
    # Get all notifications
    notifications = Notification.query.filter_by(
        user_id=current_user.id
    ).order_by(Notification.timestamp.desc()).all()
    
    # Count unread notifications
    unread_count = Notification.query.filter_by(
        user_id=current_user.id,
        is_read=False
    ).count()
    
    # Count other stats for context processor
    unviewed_snaps_count = Snap.query.filter_by(
        receiver_id=current_user.id,
        is_viewed=False
    ).count()
    
    pending_friend_requests = Friend.query.filter_by(
        friend_id=current_user.id,
        status='pending'
    ).count()
    
    return render_template('dashboard/notifications.html',
                         notifications=notifications,
                         unread_count=unread_count,
                         unviewed_snaps_count=unviewed_snaps_count,
                         pending_friend_requests=pending_friend_requests)

@app.route('/habits')
@login_required
def habits():
    user_habits = Habit.query.filter_by(user_id=current_user.id).all()
    return render_template('dashboard/habits.html', habits=user_habits)

@app.route('/habits/create', methods=['POST'])
@login_required
def create_habit():
    name = request.form.get('name')
    description = request.form.get('description')
    frequency = request.form.get('frequency', 'daily')
    
    habit = Habit(
        user_id=current_user.id,
        name=name,
        description=description,
        frequency=frequency
    )
    db.session.add(habit)
    db.session.commit()
    
    flash('Habit created successfully!', 'success')
    return redirect(url_for('habits'))

@app.route('/habits/<int:habit_id>/edit', methods=['POST'])
@login_required
def edit_habit(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    
    if habit.user_id != current_user.id:
        flash('Unauthorized access.', 'danger')
        return redirect(url_for('habits'))
    
    habit.name = request.form.get('name', habit.name)
    habit.description = request.form.get('description', habit.description)
    habit.frequency = request.form.get('frequency', habit.frequency)
    
    db.session.commit()
    flash('Habit updated successfully!', 'success')
    return redirect(url_for('habits'))

@app.route('/habits/<int:habit_id>/delete', methods=['POST'])
@login_required
def delete_habit(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    
    if habit.user_id != current_user.id:
        flash('Unauthorized access.', 'danger')
        return redirect(url_for('habits'))
    
    db.session.delete(habit)
    db.session.commit()
    flash('Habit deleted successfully!', 'success')
    return redirect(url_for('habits'))

@app.route('/habits/<int:habit_id>/complete', methods=['POST'])
@login_required
def complete_habit(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    
    if habit.user_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    # Check if already completed today
    today = datetime.utcnow().date()
    if habit.last_completed and habit.last_completed.date() == today:
        return jsonify({'success': False, 'message': 'Already completed today'})
    
    # Log completion
    log = HabitLog(user_id=current_user.id, habit_id=habit_id)
    db.session.add(log)
    
    # Update streak
    yesterday = today - timedelta(days=1)
    
    if habit.last_completed:
        last_completed_date = habit.last_completed.date()
        
        if last_completed_date == today:
            # Already completed today
            pass
        elif last_completed_date == yesterday:
            # Consecutive day
            habit.streak_count += 1
        else:
            # Broken streak
            habit.streak_count = 1
    else:
        # First completion
        habit.streak_count = 1
    
    # Update best streak
    if habit.streak_count > habit.best_streak:
        habit.best_streak = habit.streak_count
    
    habit.last_completed = datetime.utcnow()
    db.session.commit()
    
    return jsonify({'success': True, 'streak': habit.streak_count})

@app.route('/api/habits/<int:habit_id>')
@login_required
def get_habit_api(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    
    if habit.user_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    return jsonify({
        'id': habit.id,
        'name': habit.name,
        'description': habit.description,
        'frequency': habit.frequency,
        'streak_count': habit.streak_count,
        'best_streak': habit.best_streak,
        'last_completed': habit.last_completed.isoformat() if habit.last_completed else None
    })

@app.route('/friends')
@login_required
def friends():
    # Get accepted friends
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    friends_list = []
    for friendship in friendships:
        if friendship.user_id == current_user.id:
            friend = User.query.get(friendship.friend_id)
        else:
            friend = User.query.get(friendship.user_id)
        friends_list.append(friend)
    
    # Get pending requests
    pending_requests = Friend.query.filter_by(
        friend_id=current_user.id,
        status='pending'
    ).all()
    
    # Get sent requests
    sent_requests = Friend.query.filter_by(
        user_id=current_user.id,
        status='pending'
    ).all()
    
    # Get suggested friends (users not friends with, not pending, not blocked)
    all_users = User.query.filter(
        User.id != current_user.id,
        User.is_verified == True
    ).all()
    
    friend_ids = [f.id for f in friends_list]
    pending_ids = [req.user_id for req in pending_requests] + [req.friend_id for req in sent_requests]
    
    suggested = []
    for user in all_users:
        if user.id not in friend_ids and user.id not in pending_ids:
            # Check if blocked
            block = Friend.query.filter_by(
                user_id=current_user.id,
                friend_id=user.id,
                status='blocked'
            ).first()
            if not block:
                suggested.append(user)
    
    # Limit suggested to 20
    suggested = suggested[:20]
    
    return render_template('dashboard/friends.html',
                         friends=friends_list,
                         pending_requests=pending_requests,
                         sent_requests=sent_requests,
                         suggested=suggested)

@app.route('/api/friends')
@login_required
def get_friends_api():
    """Get friends list for snap sending"""
    try:
        # Get accepted friends
        friendships = Friend.query.filter(
            ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
            (Friend.status == 'accepted')
        ).all()
        
        friends_list = []
        for friendship in friendships:
            if friendship.user_id == current_user.id:
                friend = User.query.get(friendship.friend_id)
            else:
                friend = User.query.get(friendship.user_id)
            
            if friend:
                friends_list.append({
                    'id': friend.id,
                    'username': friend.username,
                    'email': friend.email,
                    'is_online': friend.is_online,
                    'avatar': friend.avatar if hasattr(friend, 'avatar') else None
                })
        
        return jsonify(friends_list)
        
    except Exception as e:
        print(f"Error getting friends: {e}")
        return jsonify([])
    
@app.route('/friends/<int:friend_id>/habits')
@login_required
def view_friend_habits(friend_id):
    """View a friend's habits and streaks"""
    
    # Check if user is friends with this person
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == friend_id)) |
        ((Friend.user_id == friend_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        flash('You can only view habits of your friends.', 'danger')
        return redirect(url_for('friends'))
    
    # Get friend details
    friend = User.query.get(friend_id)
    if not friend:
        flash('User not found.', 'danger')
        return redirect(url_for('friends'))
    
    # Get friend's habits
    habits = Habit.query.filter_by(user_id=friend_id).all()
    
    # Calculate friend's stats
    total_streak = sum(h.streak_count for h in habits)
    best_streak = max([h.best_streak for h in habits], default=0)
    active_streaks = len([h for h in habits if h.streak_count > 0])
    
    # Get recent completions (last 7 days)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    recent_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == friend_id,
        HabitLog.completed_at >= seven_days_ago
    ).order_by(HabitLog.completed_at.desc()).limit(10).all()
    
    # Calculate completion rate for last 30 days
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    total_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == friend_id,
        HabitLog.completed_at >= thirty_days_ago
    ).count()
    
    total_possible = len(habits) * 30
    completion_rate = (total_completions / total_possible * 100) if total_possible > 0 else 0
    
    return render_template('dashboard/friend_habits.html',
                         friend=friend,
                         habits=habits,
                         total_streak=total_streak,
                         best_streak=best_streak,
                         active_streaks=active_streaks,
                         recent_completions=recent_completions,
                         completion_rate=round(completion_rate, 1))

@app.route('/friends/send-request', methods=['POST'])
@login_required
def send_friend_request():
    data = request.get_json()
    friend_email = data.get('email')
    friend_username = data.get('username')
    friend_id = data.get('user_id')
    
    # Find friend by ID, email, or username
    if friend_id:
        friend = User.query.get(friend_id)
    elif friend_email:
        friend = User.query.filter_by(email=friend_email).first()
    elif friend_username:
        friend = User.query.filter_by(username=friend_username).first()
    else:
        return jsonify({'success': False, 'message': 'Please provide user identifier'})
    
    if not friend:
        return jsonify({'success': False, 'message': 'User not found'})
    
    if friend.id == current_user.id:
        return jsonify({'success': False, 'message': 'Cannot add yourself'})
    
    # Check if request already exists
    existing = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == friend.id)) |
        ((Friend.user_id == friend.id) & (Friend.friend_id == current_user.id))
    ).first()
    
    if existing:
        if existing.status == 'pending':
            return jsonify({'success': False, 'message': 'Request already sent'})
        elif existing.status == 'accepted':
            return jsonify({'success': False, 'message': 'Already friends'})
        elif existing.status == 'blocked':
            return jsonify({'success': False, 'message': 'Cannot send request to blocked user'})
    
    # Create request
    friend_request = Friend(
        user_id=current_user.id,
        friend_id=friend.id,
        status='pending'
    )
    db.session.add(friend_request)
    db.session.commit()
    
    # Notify via SocketIO
    socketio.emit('friend_request', {
        'from': current_user.username,
        'from_id': current_user.id,
        'request_id': friend_request.id
    }, room=f'user_{friend.id}')
    
    return jsonify({'success': True, 'message': 'Friend request sent'})

@app.route('/friends/accept/<int:request_id>', methods=['POST'])
@login_required
def accept_friend_request(request_id):
    friend_request = Friend.query.get_or_404(request_id)
    
    if friend_request.friend_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    friend_request.status = 'accepted'
    db.session.commit()
    
    # Notify sender
    socketio.emit('friend_request_accepted', {
        'from': current_user.username,
        'from_id': current_user.id,
        'friend_id': current_user.id
    }, room=f'user_{friend_request.user_id}')
    
    return jsonify({'success': True, 'message': 'Friend request accepted'})

@app.route('/friends/reject/<int:request_id>', methods=['POST'])
@login_required
def reject_friend_request(request_id):
    friend_request = Friend.query.get_or_404(request_id)
    
    if friend_request.friend_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    db.session.delete(friend_request)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Friend request rejected'})

@app.route('/friends/cancel/<int:request_id>', methods=['DELETE'])
@login_required
def cancel_friend_request(request_id):
    friend_request = Friend.query.get_or_404(request_id)
    
    if friend_request.user_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    db.session.delete(friend_request)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Friend request cancelled'})

@app.route('/friends/remove/<int:friend_id>', methods=['POST'])
@login_required
def remove_friend(friend_id):
    # Find the friendship (could be in either direction)
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == friend_id)) |
        ((Friend.user_id == friend_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        return jsonify({'success': False, 'message': 'Friendship not found'}), 404
    
    db.session.delete(friendship)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Friend removed'})

@app.route('/friends/block/<int:user_id>', methods=['POST'])
@login_required
def block_user(user_id):
    # Remove existing friendship if any
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == user_id)) |
        ((Friend.user_id == user_id) & (Friend.friend_id == current_user.id))
    ).first()
    
    if friendship:
        db.session.delete(friendship)
    
    # Create block
    block = Friend(
        user_id=current_user.id,
        friend_id=user_id,
        status='blocked'
    )
    db.session.add(block)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'User blocked'})

@app.route('/snaps')
@login_required
def snaps():
    # Get received snaps (last 30 days)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    received_snaps = Snap.query.filter_by(receiver_id=current_user.id)\
        .filter(Snap.created_at >= thirty_days_ago)\
        .order_by(Snap.created_at.desc())\
        .all()
    
    # Get sent snaps (last 30 days)
    sent_snaps = Snap.query.filter_by(sender_id=current_user.id)\
        .filter(Snap.created_at >= thirty_days_ago)\
        .order_by(Snap.created_at.desc())\
        .all()
    
    # Get friends for sending snaps
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    friends = []
    for friendship in friendships:
        if friendship.user_id == current_user.id:
            friend = User.query.get(friendship.friend_id)
        else:
            friend = User.query.get(friendship.user_id)
        friends.append(friend)
    
    # Get habits
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    
    # Get friend activity for suggestions
    friend_ids = [f.id for f in friends]
    friend_activity = []
    if friend_ids:
        friend_activity = Snap.query.filter(Snap.sender_id.in_(friend_ids))\
            .filter(Snap.created_at >= thirty_days_ago)\
            .order_by(Snap.created_at.desc())\
            .limit(4)\
            .all()
    
    return render_template('dashboard/snaps.html',
                         received_snaps=received_snaps,
                         sent_snaps=sent_snaps,
                         friends=friends,
                         habits=habits,
                         friend_activity=friend_activity)

@app.route('/snaps/send', methods=['POST'])
@login_required
def send_snap():
    receiver_id = request.form.get('receiver_id')
    habit_id = request.form.get('habit_id')
    caption = request.form.get('caption')
    text_content = request.form.get('text')
    
    # Check if receiver is a friend
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == receiver_id)) |
        ((Friend.user_id == receiver_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        return jsonify({'success': False, 'message': 'You can only send snaps to friends'}), 403
    
    # Handle file upload
    file = request.files.get('snap_file')
    content_type = 'text'
    content = text_content or caption or ''
    
    if file and allowed_file(file.filename):
        # Save file
        file_path = save_snap_file(file, current_user.id)
        if not file_path:
            return jsonify({'success': False, 'message': 'Failed to save file'}), 500
        
        # Determine content type
        content_type = get_file_type(file.filename)
        content = file_path
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        max_size = 50 * 1024 * 1024  # 50MB for videos
        if content_type == 'image':
            max_size = 10 * 1024 * 1024  # 10MB for images
        
        if file_size > max_size:
            # Delete the saved file
            full_path = os.path.join(app.config['UPLOAD_FOLDER'], file_path)
            if os.path.exists(full_path):
                os.remove(full_path)
            return jsonify({'success': False, 'message': f'File size exceeds {max_size//(1024*1024)}MB limit'}), 400
    
    # Validate content
    if not content:
        return jsonify({'success': False, 'message': 'Please provide content for the snap'}), 400
    
    # Create snap with 24-hour expiry
    expires_at = datetime.utcnow() + timedelta(hours=24)
    
    snap = Snap(
        sender_id=current_user.id,
        receiver_id=receiver_id,
        habit_id=habit_id if habit_id else None,
        content_type=content_type,
        content=content,
        caption=caption,
        expires_at=expires_at
    )
    db.session.add(snap)
    db.session.commit()
    
    # Notify receiver via SocketIO
    socketio.emit('new_snap', {
        'from': current_user.username,
        'from_id': current_user.id,
        'snap_id': snap.id
    }, room=f'user_{receiver_id}')
    
    return jsonify({'success': True, 'message': 'Snap sent successfully!', 'snap_id': snap.id})

@app.route('/send-snap')
@login_required
def send_snap_page():
    """Page to select friends to send snap to"""
    # Get friends for selection
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    friends_list = []
    for friendship in friendships:
        if friendship.user_id == current_user.id:
            friend = User.query.get(friendship.friend_id)
        else:
            friend = User.query.get(friendship.user_id)
        
        if friend:
            friends_list.append(friend)
    
    # Get user's habits
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    
    return render_template('dashboard/send_snap.html',
                         friends=friends_list,
                         habits=habits)

@app.route('/snaps/<int:snap_id>/view', methods=['POST'])
@login_required
def view_snap(snap_id):
    snap = Snap.query.get_or_404(snap_id)
    
    if snap.receiver_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    if not snap.is_viewed:
        snap.is_viewed = True
        db.session.commit()
        
        # Notify sender
        socketio.emit('snap_viewed', {
            'snap_id': snap_id,
            'viewer': current_user.username,
            'viewer_id': current_user.id
        }, room=f'user_{snap.sender_id}')
    
    return jsonify({'success': True})

@app.route('/snaps/<int:snap_id>/react', methods=['POST'])
@login_required
def react_to_snap(snap_id):
    snap = Snap.query.get_or_404(snap_id)
    data = request.get_json()
    emoji = data.get('emoji')
    
    if not emoji:
        return jsonify({'success': False, 'message': 'No emoji provided'}), 400
    
    # Check if user can react (sender or receiver)
    if snap.sender_id != current_user.id and snap.receiver_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    # Check if already reacted with same emoji
    existing_reaction = SnapReaction.query.filter_by(
        snap_id=snap_id,
        user_id=current_user.id,
        emoji=emoji
    ).first()
    
    if existing_reaction:
        # Remove reaction
        db.session.delete(existing_reaction)
        action = 'removed'
    else:
        # Add reaction
        reaction = SnapReaction(snap_id=snap_id, user_id=current_user.id, emoji=emoji)
        db.session.add(reaction)
        action = 'added'
    
    db.session.commit()
    
    # Notify other user
    other_user_id = snap.receiver_id if snap.sender_id == current_user.id else snap.sender_id
    socketio.emit('snap_reaction', {
        'snap_id': snap_id,
        'emoji': emoji,
        'from': current_user.username,
        'from_id': current_user.id,
        'action': action
    }, room=f'user_{other_user_id}')
    
    return jsonify({'success': True, 'action': action})

# Add these API endpoints for snap functionality

@app.route('/api/snaps/<int:snap_id>')
@login_required
def get_snap_details(snap_id):
    """Get detailed information about a specific snap"""
    snap = Snap.query.get_or_404(snap_id)
    
    # Check if user can view this snap
    if snap.sender_id != current_user.id and snap.receiver_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    return jsonify({
        'success': True,
        'snap': {
            'id': snap.id,
            'sender_id': snap.sender_id,
            'sender_username': snap.sender.username,
            'receiver_id': snap.receiver_id,
            'receiver_username': snap.receiver.username,
            'habit_id': snap.habit_id,
            'content_type': snap.content_type,
            'content': snap.content,
            'caption': snap.caption,
            'is_viewed': snap.is_viewed,
            'created_at': snap.created_at.isoformat(),
            'expires_at': snap.expires_at.isoformat(),
            'reactions': [{
                'id': r.id,
                'emoji': r.emoji,
                'user_id': r.user_id,
                'username': r.user.username,
                'created_at': r.created_at.isoformat()
            } for r in snap.reactions]
        }
    })

@app.route('/api/snaps/received')
@login_required
def get_received_snaps():
    """Get received snaps for the current user"""
    try:
        # Get received snaps (last 30 days)
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        received_snaps = Snap.query.filter_by(receiver_id=current_user.id)\
            .filter(Snap.created_at >= thirty_days_ago)\
            .order_by(Snap.created_at.desc())\
            .all()
        
        snaps_data = []
        for snap in received_snaps:
            # Check if snap is saved
            is_saved = snap.id in get_saved_snaps_ids(current_user.id)
            
            snaps_data.append({
                'id': snap.id,
                'sender_id': snap.sender_id,
                'sender_username': snap.sender.username,
                'content_type': snap.content_type,
                'content': snap.content,
                'caption': snap.caption,
                'is_viewed': snap.is_viewed,
                'created_at': snap.created_at.isoformat(),
                'expires_at': snap.expires_at.isoformat(),
                'is_saved': is_saved
            })
        
        return jsonify({
            'success': True,
            'snaps': snaps_data
        })
        
    except Exception as e:
        print(f"Error getting received snaps: {e}")
        return jsonify({'success': False, 'message': 'Internal server error'}), 500


@app.route('/snaps/<int:snap_id>/download')
@login_required
def download_snap(snap_id):
    """Download a snap file"""
    snap = Snap.query.get_or_404(snap_id)
    
    # Check if user can download this snap
    if snap.sender_id != current_user.id and snap.receiver_id != current_user.id:
        flash('Unauthorized access.', 'danger')
        return redirect(url_for('snaps'))
    
    if snap.content_type == 'text':
        # For text snaps, create a text file
        content = f"Snap from {snap.sender.username}\n\n"
        content += f"Sent: {snap.created_at.strftime('%Y-%m-%d %H:%M:%S')}\n"
        content += f"Expires: {snap.expires_at.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        content += f"Content:\n{snap.content}\n\n"
        if snap.caption:
            content += f"Caption: {snap.caption}\n"
        
        # Create response with text file
        response = Response(
            content,
            mimetype="text/plain",
            headers={
                "Content-Disposition": f"attachment; filename=snap_{snap.id}_{snap.created_at.strftime('%Y%m%d_%H%M%S')}.txt"
            }
        )
        return response
    
    elif snap.content_type in ['image', 'video']:
        # For image/video, serve the file
        if snap.content:
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], snap.content)
            if os.path.exists(file_path):
                # Determine appropriate filename
                filename = f"snap_{snap.id}_{snap.created_at.strftime('%Y%m%d_%H%M%S')}"
                if snap.content_type == 'image':
                    ext = os.path.splitext(snap.content)[1] or '.jpg'
                    filename += ext
                else:  # video
                    ext = os.path.splitext(snap.content)[1] or '.mp4'
                    filename += ext
                
                return send_file(
                    file_path,
                    as_attachment=True,
                    download_name=filename,
                    mimetype=mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
                )
    
    flash('Snap file not found.', 'danger')
    return redirect(url_for('snaps'))

@app.route('/api/snaps/<int:snap_id>/download-info')
@login_required
def get_snap_download_info(snap_id):
    """Get information for downloading a snap"""
    snap = Snap.query.get_or_404(snap_id)
    
    # Check if user can access this snap
    if snap.sender_id != current_user.id and snap.receiver_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    return jsonify({
        'success': True,
        'snap': {
            'id': snap.id,
            'content_type': snap.content_type,
            'filename': snap.content,
            'created_at': snap.created_at.isoformat(),
            'sender_username': snap.sender.username,
            'caption': snap.caption
        }
    })

def get_saved_snaps_ids(user_id):
    """Helper function to get saved snap IDs for a user"""
    return session.get('saved_snaps', [])

def save_snap_file(file, user_id):
    """Save snap file with proper naming and path - UPDATED"""
    if not file:
        return None
    
    # Generate unique filename
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    original_filename = secure_filename(file.filename)
    filename = f"snap_{user_id}_{timestamp}_{original_filename}"
    
    # Determine file type and subdirectory
    file_type = get_file_type(original_filename)
    if file_type == 'video':
        upload_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'videos')
        relative_path = f'videos/{filename}'
    elif file_type == 'image':
        upload_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'snaps')
        relative_path = f'snaps/{filename}'
    else:
        upload_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'snaps')
        relative_path = f'snaps/{filename}'
    
    # Ensure directory exists
    os.makedirs(upload_dir, exist_ok=True)
    
    # Save file
    filepath = os.path.join(upload_dir, filename)
    file.save(filepath)
    
    return relative_path

# Add this helper function to check if text contains emojis
def contains_emoji(text):
    """Check if text contains emoji characters"""
    import re
    # Regex pattern for emojis
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags (iOS)
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "]+", flags=re.UNICODE)
    
    return bool(emoji_pattern.search(text))

@app.route('/api/snaps/sent')
@login_required
def get_sent_snaps():
    """Get sent snaps for the current user"""
    try:
        # Get sent snaps (last 30 days)
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        sent_snaps = Snap.query.filter_by(sender_id=current_user.id)\
            .filter(Snap.created_at >= thirty_days_ago)\
            .order_by(Snap.created_at.desc())\
            .all()
        
        snaps_data = []
        for snap in sent_snaps:
            snaps_data.append({
                'id': snap.id,
                'receiver_id': snap.receiver_id,
                'receiver_username': snap.receiver.username,
                'content_type': snap.content_type,
                'content': snap.content,
                'caption': snap.caption,
                'is_viewed': snap.is_viewed,
                'created_at': snap.created_at.isoformat(),
                'expires_at': snap.expires_at.isoformat(),
            })
        
        return jsonify({
            'success': True,
            'sent_snaps': snaps_data
        })
        
    except Exception as e:
        print(f"Error getting sent snaps: {e}")
        return jsonify({'success': False, 'message': 'Internal server error'}), 500

@app.route('/analytics')
@login_required
def analytics():
    # Get habit completion stats (last 30 days)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    
    habit_stats = []
    for habit in habits:
        # Count completions in last 30 days
        completions = HabitLog.query.filter(
            HabitLog.habit_id == habit.id,
            HabitLog.completed_at >= thirty_days_ago
        ).count()
        
        percentage = (completions / 30) * 100 if completions > 0 else 0
        
        habit_stats.append({
            'id': habit.id,
            'name': habit.name,
            'description': habit.description,
            'streak': habit.streak_count,
            'best_streak': habit.best_streak,
            'completion_rate': round(percentage, 1)
        })
    
    # Get friend comparison data
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    friend_comparison = []
    for friendship in friendships:
        if friendship.user_id == current_user.id:
            friend = User.query.get(friendship.friend_id)
        else:
            friend = User.query.get(friendship.user_id)
        
        friend_habits = Habit.query.filter_by(user_id=friend.id).all()
        friend_total_streak = sum(h.streak_count for h in friend_habits)
        friend_total_habits = len(friend_habits)
        
        # Calculate friend score (streak days + habit count)
        friend_score = friend_total_streak * 10 + friend_total_habits * 5
        
        friend_comparison.append({
            'id': friend.id,
            'username': friend.username,
            'total_habits': friend_total_habits,
            'total_streak': friend_total_streak,
            'score': friend_score
        })
    
    # Sort friends by score
    friend_comparison.sort(key=lambda x: x['score'], reverse=True)
    
    # Calculate user stats
    total_streak = sum(h.streak_count for h in habits)
    total_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.completed_at >= thirty_days_ago
    ).count()
    
    completion_rate = (total_completions / (len(habits) * 30)) * 100 if habits else 0
    
    # Get active friends (friends with activity in last 7 days)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    active_friends = 0
    for friend in friend_comparison:
        friend_activity = HabitLog.query.join(Habit).filter(
            Habit.user_id == friend['id'],
            HabitLog.completed_at >= seven_days_ago
        ).first()
        
        if friend_activity:
            active_friends += 1
    
    # Calculate trend (compare last 7 days with previous 7 days)
    week_ago = datetime.utcnow() - timedelta(days=7)
    two_weeks_ago = datetime.utcnow() - timedelta(days=14)
    
    recent_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.completed_at >= week_ago
    ).count()
    
    previous_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.completed_at >= two_weeks_ago,
        HabitLog.completed_at < week_ago
    ).count()
    
    trend = 0
    if previous_completions > 0:
        trend = ((recent_completions - previous_completions) / previous_completions) * 100
    
    return render_template('dashboard/analytics.html',
                         habit_stats=habit_stats,
                         friend_comparison=friend_comparison[:10],  # Top 10 only
                         total_streak=total_streak,
                         completion_rate=round(completion_rate, 1),
                         active_friends=active_friends,
                         trend=round(trend, 1))

@app.route('/api/analytics')
@login_required
def get_analytics_api():
    days = int(request.args.get('range', 30))
    
    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)
    
    # Get user's habits
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    
    # Calculate stats
    total_streak = sum(h.streak_count for h in habits)
    total_completions = 0
    total_possible = len(habits) * days
    
    for habit in habits:
        completions = HabitLog.query.filter(
            HabitLog.habit_id == habit.id,
            HabitLog.completed_at >= start_date
        ).count()
        total_completions += completions
    
    completion_rate = (total_completions / total_possible * 100) if total_possible > 0 else 0
    
    # Get active friends
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    active_friends = 0
    friend_ids = []
    for friendship in friendships:
        if friendship.user_id == current_user.id:
            friend_id = friendship.friend_id
        else:
            friend_id = friendship.user_id
        
        friend_ids.append(friend_id)
        # Check if friend was active in last 7 days
        recent_activity = HabitLog.query.join(Habit).filter(
            Habit.user_id == friend_id,
            HabitLog.completed_at >= end_date - timedelta(days=7)
        ).first()
        
        if recent_activity:
            active_friends += 1
    
    # Calculate trend (compare last 7 days with previous 7 days)
    week_ago = end_date - timedelta(days=7)
    two_weeks_ago = end_date - timedelta(days=14)
    
    recent_completions = 0
    previous_completions = 0
    
    for habit in habits:
        recent = HabitLog.query.filter(
            HabitLog.habit_id == habit.id,
            HabitLog.completed_at >= week_ago
        ).count()
        recent_completions += recent
        
        previous = HabitLog.query.filter(
            HabitLog.habit_id == habit.id,
            HabitLog.completed_at >= two_weeks_ago,
            HabitLog.completed_at < week_ago
        ).count()
        previous_completions += previous
    
    trend = 0
    if previous_completions > 0:
        trend = ((recent_completions - previous_completions) / previous_completions) * 100
    
    # Generate weekly completion data for chart
    weekly_data = []
    weekly_labels = []
    
    for i in range(4):
        week_start = start_date + timedelta(days=i*7)
        week_end = week_start + timedelta(days=7)
        
        week_completions = 0
        for habit in habits:
            completions = HabitLog.query.filter(
                HabitLog.habit_id == habit.id,
                HabitLog.completed_at >= week_start,
                HabitLog.completed_at < week_end
            ).count()
            week_completions += completions
        
        week_possible = len(habits) * 7
        week_rate = (week_completions / week_possible * 100) if week_possible > 0 else 0
        
        weekly_data.append(round(week_rate, 1))
        weekly_labels.append(f"Week {i+1}")
    
    # Generate habit distribution data
    habit_data = []
    for habit in habits[:5]:  # Top 5 habits
        completions = HabitLog.query.filter(
            HabitLog.habit_id == habit.id,
            HabitLog.completed_at >= start_date
        ).count()
        
        habit_data.append({
            'name': habit.name,
            'completions': completions
        })
    
    return jsonify({
        'stats': {
            'totalStreak': total_streak,
            'completionRate': round(completion_rate, 1),
            'activeFriends': active_friends,
            'trend': round(trend, 1)
        },
        'charts': {
            'completion': {
                'labels': weekly_labels,
                'data': weekly_data
            },
            'distribution': {
                'labels': [h['name'] for h in habit_data],
                'data': [h['completions'] for h in habit_data]
            }
        }
    })

@app.route('/api/analytics/export')
@login_required
def export_analytics():
    # Generate CSV data
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    
    csv_data = "Habit,Current Streak,Best Streak,30-Day Completions,Completion Rate\n"
    for habit in habits:
        completions = HabitLog.query.filter(
            HabitLog.habit_id == habit.id,
            HabitLog.completed_at >= thirty_days_ago
        ).count()
        
        completion_rate = (completions / 30 * 100) if completions > 0 else 0
        
        csv_data += f"{habit.name},{habit.streak_count},{habit.best_streak},{completions},{round(completion_rate, 1)}%\n"
    
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-disposition": "attachment; filename=habithero-analytics.csv"}
    )

@app.route('/logout')
@login_required
def logout():
    user_email = current_user.email
    
    current_user.is_online = False
    current_user.last_seen = datetime.utcnow()
    db.session.commit()
    
    logout_user()
    
    accounts = User.query.filter_by(email=user_email).all()
    
    if len(accounts) > 1:
        flash('You have been logged out. Please select which account to log into.', 'info')
        return redirect(url_for('login_select', email=user_email))
    else:
        flash('You have been logged out.', 'info')
        return redirect(url_for('login'))

# Email Functions
def send_verification_email(email, otp):
    msg = Message('Verify Your HabitHero Account',
                  recipients=[email])
    msg.html = render_template('emails/verification.html', otp=otp)
    mail.send(msg)

def send_password_reset_email(email, token, username=None):
    reset_url = url_for('reset_password', token=token, _external=True)
    msg = Message('Reset Your HabitHero Password',
                  recipients=[email])
    msg.html = render_template('emails/reset_password.html', 
                               reset_url=reset_url, 
                               username=username)
    mail.send(msg)

@app.route('/chat/<int:user_id>')
@login_required
def chat(user_id):
    """Chat page with a specific user - SIMPLIFIED"""
    # Check if users are friends
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == user_id)) |
        ((Friend.user_id == user_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        flash('You can only chat with friends.', 'danger')
        return redirect(url_for('friends'))
    
    # Get the other user
    other_user = User.query.get_or_404(user_id)
    
    # Get conversation history (last 50 messages)
    messages = ChatMessage.query.filter(  # CHANGED
        ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == user_id)) |
        ((ChatMessage.sender_id == user_id) & (ChatMessage.receiver_id == current_user.id))
    ).order_by(ChatMessage.timestamp.asc()).limit(50).all()
    
    # Mark received messages as read
    unread_messages = ChatMessage.query.filter_by(  # CHANGED
        receiver_id=current_user.id,
        sender_id=user_id,
        is_read=False
    ).all()
    
    for msg in unread_messages:
        msg.is_read = True
    
    # Mark notifications for this chat as read
    notifications = Notification.query.filter_by(
        user_id=current_user.id,
        is_read=False
    ).filter(Notification.text.like(f'%{other_user.username}%')).all()
    
    for notif in notifications:
        notif.is_read = True
    
    if unread_messages or notifications:
        db.session.commit()
    
    return render_template('dashboard/chat.html',
                         other_user=other_user,
                         messages=messages)

@app.route('/api/notifications')
@login_required
def get_notifications():
    """Get user notifications"""
    notifications = Notification.query.filter_by(
        user_id=current_user.id
    ).order_by(Notification.timestamp.desc()).limit(20).all()
    
    return jsonify([{
        'id': n.id,
        'text': n.text,
        'link': n.link,
        'is_read': n.is_read,
        'timestamp': n.timestamp.isoformat(),
        'time_ago': timesince_filter(n.timestamp)
    } for n in notifications])

@app.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
@login_required
def mark_notification_read(notification_id):
    """Mark a notification as read"""
    notification = Notification.query.get_or_404(notification_id)
    
    if notification.user_id != current_user.id:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    notification.is_read = True
    db.session.commit()
    
    update_notification_badge()
    
    return jsonify({'success': True})

@app.route('/api/notifications/read-all', methods=['POST'])
@login_required
def mark_all_notifications_read():
    """Mark all notifications as read"""
    Notification.query.filter_by(
        user_id=current_user.id,
        is_read=False
    ).update({'is_read': True})
    
    db.session.commit()
    update_notification_badge()
    
    return jsonify({'success': True})

@app.route('/api/notifications/unread-count')
@login_required
def get_unread_notification_count():
    """Get count of unread notifications"""
    count = Notification.query.filter_by(
        user_id=current_user.id,
        is_read=False
    ).count()
    
    return jsonify({'count': count})

@app.route('/api/chat/<int:user_id>/messages')
@login_required
def get_chat_messages(user_id):
    """Get chat messages with a user - UPDATED TO FIX STATUS"""
    # Check friendship
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == user_id)) |
        ((Friend.user_id == user_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    try:
        # Get messages with pagination
        page = request.args.get('page', 1, type=int)
        per_page = 50
        
        # Query messages between users
        messages_query = ChatMessage.query.filter(
            ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == user_id)) |
            ((ChatMessage.sender_id == user_id) & (ChatMessage.receiver_id == current_user.id))
        ).order_by(ChatMessage.timestamp.desc())
        
        # Paginate
        pagination = messages_query.paginate(page=page, per_page=per_page, error_out=False)
        messages = pagination.items
        
        # CRITICAL FIX: MARK AS READ WHEN LOADING CHAT - UPDATE BOTH FIELDS
        if page == 1:
            # Find messages sent TO current user that are unread
            unread_messages = ChatMessage.query.filter_by(
                sender_id=user_id,
                receiver_id=current_user.id,
                is_read=False
            ).all()
            
            if unread_messages:
                message_ids = []
                for msg in unread_messages:
                    msg.is_read = True
                    msg.status = 'read'  # UPDATE STATUS TOO!
                    message_ids.append(msg.id)
                
                db.session.commit()
                
                # IMMEDIATELY notify sender that messages were read
                for msg_id in message_ids:
                    socketio.emit('message_status_update', {
                        'message_id': msg_id,
                        'status': 'read',
                        'timestamp': datetime.utcnow().isoformat() + 'Z'
                    }, room=f'user_{user_id}')
                
                print(f"✅ IMMEDIATE: Marked {len(unread_messages)} messages as read from user {user_id}")
        
        # Format messages with UTC timestamps
        formatted_messages = []
        for msg in messages:
            # Ensure timestamp is UTC with 'Z' suffix
            timestamp_iso = msg.timestamp.isoformat()
            if not timestamp_iso.endswith('Z'):
                timestamp_iso += 'Z'
            
            formatted_messages.append({
                'id': msg.id,
                'sender_id': msg.sender_id,
                'sender_username': msg.sender.username,
                'content': msg.content,
                'timestamp': timestamp_iso,
                'is_read': msg.is_read,
                'status': msg.status or 'sent',  # Use database status
                'is_own': msg.sender_id == current_user.id
            })
        
        return jsonify({
            'success': True,
            'messages': formatted_messages,
            'has_next': pagination.has_next,
            'total': pagination.total
        })
        
    except Exception as e:
        print(f"❌ Error getting chat messages: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': 'Internal server error'}), 500

# 2. UPDATED: Send message HTTP API
@app.route('/api/chat/send', methods=['POST'])
@login_required
def send_chat_message():
    """Send a chat message via HTTP API - UPDATED"""
    print(f"\n🟢 HTTP MESSAGE SEND REQUEST:")
    print(f"   From: {current_user.id} ({current_user.username})")
    
    try:
        data = request.get_json()
        receiver_id = data.get('receiver_id')
        content = data.get('content', '').strip()
        
        print(f"   To: {receiver_id}")
        print(f"   Content: {content}")
        
        if not receiver_id:
            print("❌ Missing receiver_id")
            return jsonify({'success': False, 'message': 'Missing receiver_id'}), 400
        
        if not content:
            print("❌ Missing content")
            return jsonify({'success': False, 'message': 'Message content is required'}), 400
        
        # Convert to int
        receiver_id = int(receiver_id)
        
        # Check for duplicate messages
        duplicate = check_for_duplicate_message(current_user.id, receiver_id, content, 2)
        if duplicate:
            print(f"🔄 DUPLICATE DETECTED (HTTP): Message ID {duplicate.id}")
            return jsonify({
                'success': True,
                'message': {
                    'id': duplicate.id,
                    'sender_id': current_user.id,
                    'sender_username': current_user.username,
                    'receiver_id': receiver_id,
                    'content': content,
                    'timestamp': duplicate.timestamp.isoformat() + 'Z',
                    'is_read': duplicate.is_read,
                    'status': duplicate.status or 'sent',
                    'is_own': True
                }
            })
        
        # Check if users are friends
        friendship = Friend.query.filter(
            ((Friend.user_id == current_user.id) & (Friend.friend_id == receiver_id)) |
            ((Friend.user_id == receiver_id) & (Friend.friend_id == current_user.id))
        ).filter_by(status='accepted').first()
        
        if not friendship:
            print("❌ Users are not friends")
            return jsonify({'success': False, 'message': 'Users are not friends'}), 403
        
        # Check if receiver is online for status
        receiver = User.query.get(receiver_id)
        is_receiver_online = receiver and receiver.is_online
        
        # Set initial status: 'delivered' if online, 'sent' if offline
        initial_status = 'delivered' if is_receiver_online else 'sent'
        
        # Create message with proper initial status
        message = ChatMessage(
            sender_id=current_user.id,
            receiver_id=receiver_id,
            content=content,
            status=initial_status,
            is_read=False
        )
        db.session.add(message)
        db.session.flush()  # Get ID without committing
        
        # Create notification
        notification = Notification(
            user_id=receiver_id,
            text=f"💬 New message from {current_user.username}",
            link=f"/chat/{current_user.id}"
        )
        db.session.add(notification)
        db.session.commit()
        
        print(f"✅ Message saved: ID={message.id}, Status={initial_status}")
        
        # Prepare message data with UTC timestamp
        message_data = {
            'id': message.id,
            'sender_id': current_user.id,
            'sender_username': current_user.username,
            'receiver_id': receiver_id,
            'content': content,
            'timestamp': message.timestamp.isoformat() + 'Z',
            'is_read': False,
            'status': initial_status
        }
        
        # Emit via Socket.IO if receiver is online
        if is_receiver_online:
            try:
                socketio.emit('new_message', message_data, room=f'user_{receiver_id}')
                print(f"✅ Socket.IO emit to user_{receiver_id}")
            except Exception as socket_error:
                print(f"⚠️ Socket.IO emit failed: {socket_error}")
        
        return jsonify({
            'success': True,
            'message': {
                'id': message.id,
                'sender_id': current_user.id,
                'sender_username': current_user.username,
                'content': content,
                'timestamp': message.timestamp.isoformat() + 'Z',
                'is_read': False,
                'status': initial_status,
                'is_own': True
            }
        })
        
    except Exception as e:
        print(f"❌ ERROR in send_chat_message: {e}")
        import traceback
        traceback.print_exc()
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Internal server error'}), 500

# 3. NEW: HTTP endpoint to mark messages as read (for socket fallback)
@app.route('/api/chat/<int:sender_id>/mark-read', methods=['POST'])
@login_required
def mark_messages_read_http(sender_id):
    """Mark messages as read via HTTP API (socket fallback)"""
    try:
        # Find unread messages from this sender
        unread_messages = ChatMessage.query.filter_by(
            sender_id=sender_id,
            receiver_id=current_user.id,
            is_read=False
        ).all()
        
        message_ids = []
        for msg in unread_messages:
            msg.is_read = True
            msg.status = 'read'  # UPDATE STATUS TOO
            message_ids.append(msg.id)
        
        db.session.commit()
        
        print(f"✅ HTTP: Marked {len(unread_messages)} messages from {sender_id} as read")
        
        # Notify sender via socket
        for msg_id in message_ids:
            socketio.emit('message_status_update', {
                'message_id': msg_id,
                'status': 'read',
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }, room=f'user_{sender_id}')
        
        return jsonify({
            'success': True,
            'count': len(unread_messages),
            'message_ids': message_ids
        })
        
    except Exception as e:
        print(f"❌ Error in mark_messages_read_http: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Internal server error'}), 500

# 4. DEBUG: Get message status for debugging
@app.route('/debug/messages/<int:user_id1>/<int:user_id2>')
@login_required
def debug_messages(user_id1, user_id2):
    """Debug endpoint to check message status between two users"""
    
    messages = ChatMessage.query.filter(
        ((ChatMessage.sender_id == user_id1) & (ChatMessage.receiver_id == user_id2)) |
        ((ChatMessage.sender_id == user_id2) & (ChatMessage.receiver_id == user_id1))
    ).order_by(ChatMessage.timestamp.asc()).all()
    
    result = []
    for msg in messages:
        result.append({
            'id': msg.id,
            'sender_id': msg.sender_id,
            'receiver_id': msg.receiver_id,
            'content': msg.content[:50] + '...' if len(msg.content) > 50 else msg.content,
            'status': msg.status,
            'is_read': msg.is_read,
            'timestamp': msg.timestamp.isoformat(),
            'expected_status': 'read' if msg.is_read else (msg.status or 'sent')
        })
    
    return jsonify({
        'success': True,
        'count': len(messages),
        'messages': result,
        'inconsistent': [m for m in result if m['status'] != m['expected_status']]
    })

@app.route('/chat')
@login_required
def chat_index():
    """Chat index page showing recent conversations"""
    # Get users you've chatted with recently
    recent_chats = db.session.query(
        User,
        db.func.max(ChatMessage.timestamp).label('last_message_time')  # CHANGED
    ).join(
        ChatMessage,  # CHANGED
        db.or_(
            (ChatMessage.sender_id == User.id) & (ChatMessage.receiver_id == current_user.id),
            (ChatMessage.receiver_id == User.id) & (ChatMessage.sender_id == current_user.id)
        )
    ).filter(User.id != current_user.id).group_by(User.id).order_by(
        db.desc('last_message_time')
    ).limit(20).all()
    
    # Get unread counts for each chat
    chat_data = []
    for user, last_time in recent_chats:
        unread_count = ChatMessage.query.filter_by(  # CHANGED
            sender_id=user.id,
            receiver_id=current_user.id,
            is_read=False
        ).count()
        
        # Check if users are friends
        friendship = Friend.query.filter(
            ((Friend.user_id == current_user.id) & (Friend.friend_id == user.id)) |
            ((Friend.user_id == user.id) & (Friend.friend_id == current_user.id))
        ).filter_by(status='accepted').first()
        
        if friendship:
            chat_data.append({
                'user': user,
                'last_message_time': last_time,
                'unread_count': unread_count
            })
    
    # Get friends you haven't chatted with yet
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    
    friends_without_chat = []
    for friendship in friendships:
        if friendship.user_id == current_user.id:
            friend_id = friendship.friend_id
        else:
            friend_id = friendship.user_id
        
        # Check if already in recent chats
        if not any(chat['user'].id == friend_id for chat in chat_data):
            friend = User.query.get(friend_id)
            if friend:
                friends_without_chat.append(friend)
    
    return render_template('dashboard/chat_index.html',
                         recent_chats=chat_data,
                         friends_without_chat=friends_without_chat)

@app.route('/api/chat/message/delete', methods=['POST'])
@login_required
def delete_message():
    """Delete a message (for me or for everyone)"""
    data = request.get_json()
    message_id = data.get('message_id')
    delete_type = data.get('delete_type', 'me')  # 'me' or 'everyone'
    
    if not message_id:
        return jsonify({'success': False, 'message': 'Message ID required'}), 400
    
    message = ChatMessage.query.get_or_404(message_id)
    
    # Check permissions
    if delete_type == 'me':
        # User can only delete for themselves if they're sender or receiver
        if message.sender_id != current_user.id and message.receiver_id != current_user.id:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        # Mark as deleted for this user (soft delete)
        # In production, you might want to create a DeletedMessage table
        # For now, we'll just return success
        return jsonify({'success': True, 'message': 'Message deleted for you'})
    
    elif delete_type == 'everyone':
        # Only sender can delete for everyone, and only within 5 minutes
        if message.sender_id != current_user.id:
            return jsonify({'success': False, 'message': 'Only sender can delete for everyone'}), 403
        
        # Check time limit (5 minutes)
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        if message.timestamp < five_minutes_ago:
            return jsonify({'success': False, 'message': 'Can only delete messages within 5 minutes'}), 400
        
        # Actually delete the message from database
        db.session.delete(message)
        
        # Notify the receiver via Socket.IO
        socketio.emit('message_deleted', {
            'message_id': message_id,
            'deleted_by': current_user.username,
            'deleted_by_id': current_user.id
        }, room=f'user_{message.receiver_id}')
        
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Message deleted for everyone'})
    
    return jsonify({'success': False, 'message': 'Invalid delete type'}), 400

@app.route('/api/chat/message/edit', methods=['POST'])
@login_required
def edit_message():
    """Edit a message"""
    data = request.get_json()
    message_id = data.get('message_id')
    new_content = data.get('new_content', '').strip()
    
    if not message_id or not new_content:
        return jsonify({'success': False, 'message': 'Message ID and content required'}), 400
    
    message = ChatMessage.query.get_or_404(message_id)
    
    # Only sender can edit
    if message.sender_id != current_user.id:
        return jsonify({'success': False, 'message': 'Only sender can edit message'}), 403
    
    # Check time limit (15 minutes for editing)
    fifteen_minutes_ago = datetime.utcnow() - timedelta(minutes=15)
    if message.timestamp < fifteen_minutes_ago:
        return jsonify({'success': False, 'message': 'Can only edit messages within 15 minutes'}), 400
    
    # Update message
    message.content = new_content
    message.edited = True
    
    # Notify receiver via Socket.IO
    socketio.emit('message_edited', {
        'message_id': message_id,
        'new_content': new_content,
        'edited_by': current_user.username,
        'edited_by_id': current_user.id,
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }, room=f'user_{message.receiver_id}')
    
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Message edited'})

@app.route('/api/chat/message/forward', methods=['POST'])
@login_required
def forward_message():
    """Forward a message to another friend"""
    data = request.get_json()
    message_id = data.get('message_id')
    to_friend_id = data.get('to_friend_id')
    
    if not message_id or not to_friend_id:
        return jsonify({'success': False, 'message': 'Message ID and friend ID required'}), 400
    
    # Get original message
    original_message = ChatMessage.query.get_or_404(message_id)
    
    # Check if users are friends
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == to_friend_id)) |
        ((Friend.user_id == to_friend_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        return jsonify({'success': False, 'message': 'You can only forward to friends'}), 403
    
    # Create forwarded message
    forwarded_content = f'(Forwarded) {original_message.content}'
    
    forwarded_message = ChatMessage(
        sender_id=current_user.id,
        receiver_id=to_friend_id,
        content=forwarded_content,
        is_forwarded=True,
        original_message_id=message_id
    )
    db.session.add(forwarded_message)
    db.session.flush()  # Get ID
    
    # Create notification
    notification = Notification(
        user_id=to_friend_id,
        text=f"📨 {current_user.username} forwarded you a message",
        link=f"/chat/{current_user.id}"
    )
    db.session.add(notification)
    
    db.session.commit()
    
    # Notify receiver via Socket.IO
    socketio.emit('new_message', {
        'id': forwarded_message.id,
        'sender_id': current_user.id,
        'sender_username': current_user.username,
        'receiver_id': to_friend_id,
        'content': forwarded_content,
        'timestamp': forwarded_message.timestamp.isoformat() + 'Z',
        'is_read': False,
        'status': 'sent',
        'is_forwarded': True
    }, room=f'user_{to_friend_id}')
    
    return jsonify({
        'success': True,
        'message': 'Message forwarded',
        'forwarded_message_id': forwarded_message.id
    })

@app.route('/api/chat/recent')
@login_required
def get_recent_chats():
    """Get recent chats for the current user"""
    
    # Get users you've chatted with recently
    recent_chats = db.session.query(
        User,
        db.func.max(ChatMessage.timestamp).label('last_message_time'),  # CHANGED
        db.func.count(ChatMessage.id).label('message_count')  # CHANGED
    ).join(
        ChatMessage,  # CHANGED
        db.or_(
            (ChatMessage.sender_id == User.id) & (ChatMessage.receiver_id == current_user.id),
            (ChatMessage.receiver_id == User.id) & (ChatMessage.sender_id == current_user.id)
        )
    ).filter(User.id != current_user.id).group_by(User.id).order_by(
        db.desc('last_message_time')
    ).limit(20).all()
    
    # Get unread counts for each chat
    result = []
    for user, last_time, msg_count in recent_chats:
        # Check if users are friends
        friendship = Friend.query.filter(
            ((Friend.user_id == current_user.id) & (Friend.friend_id == user.id)) |
            ((Friend.user_id == user.id) & (Friend.friend_id == current_user.id))
        ).filter_by(status='accepted').first()
        
        if friendship:
            unread_count = ChatMessage.query.filter_by(  # CHANGED
                sender_id=user.id,
                receiver_id=current_user.id,
                is_read=False
            ).count()
            
            # Get last message content
            last_message = ChatMessage.query.filter(  # CHANGED
                ((ChatMessage.sender_id == current_user.id) & (ChatMessage.receiver_id == user.id)) |
                ((ChatMessage.sender_id == user.id) & (ChatMessage.receiver_id == current_user.id))
            ).order_by(ChatMessage.timestamp.desc()).first()
            
            result.append({
                'user_id': user.id,
                'username': user.username,
                'is_online': user.is_online,
                'last_message_time': last_time.isoformat() if last_time else None,
                'last_message': last_message.content if last_message else None,
                'unread_count': unread_count,
                'message_count': msg_count
            })
    
    return jsonify(result)

# Serve uploaded files
@app.route('/uploads/<path:filename>')
@login_required
def uploaded_file(filename):
    if filename.startswith('snaps/') or filename.startswith('videos/'):
        pass
    
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Error Handlers
@app.errorhandler(404)
def not_found_error(error):
    return render_template('errors/404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return render_template('errors/500.html'), 500

# API endpoints for camera functionality
@app.route('/api/camera/save', methods=['POST'])
@login_required
def save_camera_photo():
    """Save photo taken with camera"""
    if 'photo' not in request.files:
        return jsonify({'success': False, 'message': 'No photo provided'}), 400
    
    photo = request.files['photo']
    if not allowed_file(photo.filename):
        return jsonify({'success': False, 'message': 'Invalid file type'}), 400
    
    # Save the photo
    file_path = save_snap_file(photo, current_user.id)
    if not file_path:
        return jsonify({'success': False, 'message': 'Failed to save photo'}), 500
    
    return jsonify({
        'success': True,
        'file_path': file_path,
        'content_type': get_file_type(photo.filename)
    })

@app.route('/api/snaps/recent')
@login_required
def get_recent_snaps():
    """Get recent snaps for the user"""
    limit = int(request.args.get('limit', 10))
    
    # Get received snaps
    received_snaps = Snap.query.filter_by(receiver_id=current_user.id)\
        .order_by(Snap.created_at.desc())\
        .limit(limit)\
        .all()
    
    # Get sent snaps
    sent_snaps = Snap.query.filter_by(sender_id=current_user.id)\
        .order_by(Snap.created_at.desc())\
        .limit(limit)\
        .all()
    
    def snap_to_dict(snap):
        return {
            'id': snap.id,
            'sender_id': snap.sender_id,
            'receiver_id': snap.receiver_id,
            'sender_username': snap.sender.username,
            'receiver_username': snap.receiver.username,
            'content_type': snap.content_type,
            'content': snap.content,
            'caption': snap.caption,
            'is_viewed': snap.is_viewed,
            'created_at': snap.created_at.isoformat(),
            'expires_at': snap.expires_at.isoformat(),
            'reactions': [{
                'emoji': r.emoji,
                'user_id': r.user_id,
                'username': r.user.username
            } for r in snap.reactions]
        }
    
    return jsonify({
        'received': [snap_to_dict(snap) for snap in received_snaps],
        'sent': [snap_to_dict(snap) for snap in sent_snaps]
    })

# Clean up expired snaps (could be run as a cron job)
@app.route('/admin/cleanup-expired-snaps')
def cleanup_expired_snaps():
    """Admin endpoint to clean up expired snaps"""
    # This should be protected in production
    expired_snaps = Snap.query.filter(Snap.expires_at < datetime.utcnow()).all()
    
    count = 0
    for snap in expired_snaps:
        # Delete associated file
        if snap.content and (snap.content.startswith('snaps/') or snap.content.startswith('videos/')):
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], snap.content)
            if os.path.exists(file_path):
                os.remove(file_path)
        
        # Delete reactions
        SnapReaction.query.filter_by(snap_id=snap.id).delete()
        
        # Delete snap
        db.session.delete(snap)
        count += 1
    
    db.session.commit()
    
    return jsonify({'success': True, 'message': f'Cleaned up {count} expired snaps'})

@app.route('/profile')
@login_required
def profile():
    """User profile page"""
    # Get user stats
    total_habits = Habit.query.filter_by(user_id=current_user.id).count()
    
    # Calculate current streak (longest current streak among habits)
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    current_streak = max([h.streak_count for h in habits], default=0)
    
    # Count snaps sent
    snaps_sent = Snap.query.filter_by(sender_id=current_user.id).count()
    
    # Count friends
    friendships = Friend.query.filter(
        ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
        (Friend.status == 'accepted')
    ).all()
    friends_count = len(set([f.user_id for f in friendships] + [f.friend_id for f in friendships])) - 1
    
    # Get recent activity (last 7 days)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    recent_activity = []
    
    # Add habit completions from last 7 days
    recent_logs = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.completed_at >= seven_days_ago
    ).order_by(HabitLog.completed_at.desc()).limit(10).all()
    
    for log in recent_logs:
        recent_activity.append({
            'icon': 'fas fa-check-circle',
            'title': f'Completed "{log.habit.name}"',
            'time': timesince_filter(log.completed_at),
            'type': 'habit'
        })
    
    # Add snap activity from last 7 days
    recent_snaps = Snap.query.filter(
        Snap.sender_id == current_user.id,
        Snap.created_at >= seven_days_ago
    ).order_by(Snap.created_at.desc()).limit(10).all()
    
    for snap in recent_snaps:
        recent_activity.append({
            'icon': 'fas fa-camera',
            'title': f'Sent snap to {snap.receiver.username}',
            'time': timesince_filter(snap.created_at),
            'type': 'snap'
        })
    
    # Add friend activity from last 7 days
    recent_friends = Friend.query.filter(
        (Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id),
        Friend.status == 'accepted',
        Friend.created_at >= seven_days_ago
    ).order_by(Friend.created_at.desc()).limit(10).all()
    
    for friend in recent_friends:
        if friend.user_id == current_user.id:
            friend_user = User.query.get(friend.friend_id)
            recent_activity.append({
                'icon': 'fas fa-user-plus',
                'title': f'Added {friend_user.username} as friend',
                'time': timesince_filter(friend.created_at),
                'type': 'friend'
            })
    
    # Sort by time (newest first)
    recent_activity.sort(key=lambda x: x['time'], reverse=True)
    recent_activity = recent_activity[:10]  # Limit to 10 most recent
    
    # Get user bio - handle if column doesn't exist
    bio = ''
    if hasattr(current_user, 'bio'):
        bio = current_user.bio if current_user.bio else ''
    
    # Get user avatar - handle if column doesn't exist
    avatar = ''
    if hasattr(current_user, 'avatar'):
        avatar = current_user.avatar if current_user.avatar else ''
    
    # Calculate total streaks
    total_streaks = sum(h.streak_count for h in habits)
    
    # Get best streak
    best_streak = max([h.best_streak for h in habits], default=0)
    
    # Get completion rate for last 30 days
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    total_completions = HabitLog.query.join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.completed_at >= thirty_days_ago
    ).count()
    
    total_possible = total_habits * 30
    completion_rate = (total_completions / total_possible * 100) if total_possible > 0 else 0
    
    return render_template('dashboard/profile.html',
                         total_habits=total_habits,
                         current_streak=current_streak,
                         best_streak=best_streak,
                         total_streaks=total_streaks,
                         snaps_sent=snaps_sent,
                         friends_count=friends_count,
                         recent_activity=recent_activity,
                         bio=bio,
                         avatar=avatar,
                         completion_rate=round(completion_rate, 1),
                         total_completions=total_completions)

@app.route('/api/profile/update', methods=['POST'])
@login_required
def update_profile():
    """Update user profile information"""
    data = request.get_json()
    username = data.get('username', '').strip()
    bio = data.get('bio', '').strip()
    
    # Validate username
    if not username:
        return jsonify({'success': False, 'message': 'Username is required'})
    
    if len(username) < 3:
        return jsonify({'success': False, 'message': 'Username must be at least 3 characters'})
    
    if len(username) > 20:
        return jsonify({'success': False, 'message': 'Username cannot exceed 20 characters'})
    
    # Check if username is already taken (by another user)
    existing_user = User.query.filter(
        User.username == username,
        User.id != current_user.id
    ).first()
    
    if existing_user:
        return jsonify({'success': False, 'message': 'Username already taken'})
    
    # Update user profile
    try:
        current_user.username = username
        
        # Only update bio if the column exists
        if hasattr(current_user, 'bio'):
            current_user.bio = bio
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Profile updated successfully',
            'new_username': current_user.username
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error updating profile: {str(e)}'})

@app.route('/api/profile/change-password', methods=['POST'])
@login_required
def change_password():
    """Change user password"""
    data = request.get_json()
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    confirm_password = data.get('confirm_password', '')
    
    # Validate inputs
    if not current_password or not new_password or not confirm_password:
        return jsonify({'success': False, 'message': 'All password fields are required'})
    
    # Verify current password
    if not bcrypt.check_password_hash(current_user.password_hash, current_password):
        return jsonify({'success': False, 'message': 'Current password is incorrect'})
    
    # Check if new passwords match
    if new_password != confirm_password:
        return jsonify({'success': False, 'message': 'New passwords do not match'})
    
    # Validate new password strength
    errors = validate_password(new_password)
    if errors:
        return jsonify({'success': False, 'message': errors[0]})
    
    # Update password
    try:
        current_user.password_hash = bcrypt.generate_password_hash(new_password).decode('utf-8')
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Password changed successfully'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error changing password: {str(e)}'})

@app.route('/api/profile/update-avatar', methods=['POST'])
@login_required
def update_avatar():
    """Update user avatar"""
    data = request.get_json()
    avatar_type = data.get('avatar', '').strip()
    
    if not avatar_type:
        return jsonify({'success': False, 'message': 'Avatar type is required'})
    
    try:
        # Only update if column exists
        if hasattr(current_user, 'avatar'):
            current_user.avatar = avatar_type
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'message': 'Avatar updated successfully',
            'avatar': avatar_type
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error updating avatar: {str(e)}'})

@app.route('/settings')
@login_required
def settings():
    """Settings page - redirects to profile for now"""
    return redirect(url_for('profile'))

@app.route('/privacy')
def privacy():
    """Privacy policy page"""
    return render_template('service/privacy.html')

@app.route('/terms')
def terms():
    """Terms of service page"""
    return render_template('service/terms.html')

@app.route('/contact')
def contact():
    """Contact page"""
    return render_template('service/contact.html')

@app.route('/api/check-username', methods=['POST'])
def check_username_availability():
    """Check if a username is available"""
    data = request.get_json()
    username = data.get('username', '').strip()
    
    if not username:
        return jsonify({'available': False, 'message': 'Username is required'})
    
    # Validate username format
    if len(username) < 3 or len(username) > 20:
        return jsonify({'available': False, 'message': 'Username must be 3-20 characters'})
    
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return jsonify({'available': False, 'message': 'Username can only contain letters, numbers, and underscores'})
    
    # Check if username exists
    existing_user = User.query.filter_by(username=username).first()
    
    if existing_user:
        return jsonify({'available': False, 'message': 'Username already taken'})
    
    return jsonify({'available': True, 'message': 'Username is available'})

def fix_database_schema():
    """Add missing columns to database tables"""
    from sqlalchemy import inspect, text
    
    inspector = inspect(db.engine)
    
    # Check if 'status' column exists in message table
    columns = [col['name'] for col in inspector.get_columns('message')]
    
    if 'status' not in columns:
        print("Adding 'status' column to message table...")
        try:
            # For SQLite
            db.engine.execute('ALTER TABLE message ADD COLUMN status VARCHAR(20) DEFAULT "sent"')
            print("✓ Added 'status' column to message table")
        except Exception as e:
            print(f"Error adding status column: {e}")
    
    # Also check for other missing columns
    user_columns = [col['name'] for col in inspector.get_columns('user')]
    
    if 'bio' not in user_columns:
        print("Adding 'bio' column to user table...")
        try:
            db.engine.execute('ALTER TABLE user ADD COLUMN bio TEXT')
            print("✓ Added 'bio' column to user table")
        except Exception as e:
            print(f"Error adding bio column: {e}")
    
    if 'avatar' not in user_columns:
        print("Adding 'avatar' column to user table...")
        try:
            db.engine.execute('ALTER TABLE user ADD COLUMN avatar VARCHAR(200)')
            print("✓ Added 'avatar' column to user table")
        except Exception as e:
            print(f"Error adding avatar column: {e}")

def migrate_database():
    """Add missing columns to existing tables"""
    from sqlalchemy import inspect, text
    
    inspector = inspect(db.engine)
    
    # Check if 'bio' column exists in user table
    user_columns = [col['name'] for col in inspector.get_columns('user')]
    
    if 'bio' not in user_columns:
        print("Adding 'bio' column to user table...")
        try:
            db.engine.execute('ALTER TABLE user ADD COLUMN bio TEXT')
            print("✓ Added 'bio' column to user table")
        except Exception as e:
            print(f"Error adding bio column: {e}")
    
    if 'avatar' not in user_columns:
        print("Adding 'avatar' column to user table...")
        try:
            db.engine.execute('ALTER TABLE user ADD COLUMN avatar VARCHAR(200)')
            print("✓ Added 'avatar' column to user table")
        except Exception as e:
            print(f"Error adding avatar column: {e}")
    
    # Check if 'status' column exists in message table
    try:
        message_columns = [col['name'] for col in inspector.get_columns('message')]
        
        if 'status' not in message_columns:
            print("Adding 'status' column to message table...")
            try:
                db.engine.execute('ALTER TABLE message ADD COLUMN status VARCHAR(20) DEFAULT "sent"')
                print("✓ Added 'status' column to message table")
            except Exception as e:
                print(f"Error adding status column: {e}")
    except Exception as e:
        print(f"Error checking message table: {e}")
        # Create message table if it doesn't exist
        try:
            db.engine.execute('''
                CREATE TABLE IF NOT EXISTS message (
                    id INTEGER PRIMARY KEY,
                    sender_id INTEGER NOT NULL,
                    receiver_id INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_read BOOLEAN DEFAULT FALSE,
                    status VARCHAR(20) DEFAULT 'sent',
                    FOREIGN KEY (sender_id) REFERENCES user (id),
                    FOREIGN KEY (receiver_id) REFERENCES user (id)
                )
            ''')
            print("✓ Created message table")
        except Exception as e:
            print(f"Error creating message table: {e}")
    
    print("✓ Database migration completed")

@app.route('/api/check-auth')
def check_auth():
    """Check if user is authenticated and return status"""
    if current_user.is_authenticated:
        return jsonify({
            'authenticated': True,
            'user_id': current_user.id,
            'username': current_user.username,
            'redirect': url_for('dashboard')
        })
    return jsonify({'authenticated': False})

with app.app_context():
    db.create_all()
    try:
        migrate_database()
    except Exception as e:
        print(f"Migration error (might be first run): {e}")
    
    print("✓ Database tables created/migrated successfully")
    
###############################################################################
# SOCKET.IO ROUTES - ADDED AT THE END AS REQUESTED
###############################################################################

@socketio.on('connect')
def handle_connect():
    """Handle user connection"""
    if current_user.is_authenticated:
        # Join user's personal room for notifications
        join_room(f'user_{current_user.id}')
        
        # Update user status to online
        current_user.is_online = True
        current_user.last_seen = datetime.utcnow()
        db.session.commit()

        friendships = Friend.query.filter(
            ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
            (Friend.status == 'accepted')
        ).all()
        
        # Send status update to all friends
        for friendship in friendships:
            friend_id = friendship.friend_id if friendship.user_id == current_user.id else friendship.user_id
            
            # Send instant status update to friend
            socketio.emit('user_status', {
                'user_id': current_user.id, 
                'status': 'online',
                'username': current_user.username,
                'timestamp': datetime.utcnow().isoformat(),
                'reason': 'connected',
                'instant': True  # Mark as instant update
            }, room=f'user_{friend_id}')
        
        print(f"✅ User {current_user.username} connected (Socket ID: {request.sid})")
        print(f"📢 Broadcasted online status to friends")

@app.route('/api/user/<int:user_id>/status')
@login_required
def get_user_status(user_id):
    """Get immediate user status (online/offline)"""
    # Check if users are friends
    friendship = Friend.query.filter(
        ((Friend.user_id == current_user.id) & (Friend.friend_id == user_id)) |
        ((Friend.user_id == user_id) & (Friend.friend_id == current_user.id))
    ).filter_by(status='accepted').first()
    
    if not friendship:
        return jsonify({'success': False, 'message': 'Not friends'}), 403
    
    user = User.query.get_or_404(user_id)
    
    # Check if user is actually online (connected in last 2 minutes)
    two_minutes_ago = datetime.utcnow() - timedelta(minutes=2)
    is_really_online = user.is_online and user.last_seen > two_minutes_ago
    
    # Update if incorrectly marked as online
    if user.is_online and not is_really_online:
        user.is_online = False
        db.session.commit()
    
    return jsonify({
        'success': True,
        'user_id': user.id,
        'status': 'online' if is_really_online else 'offline',
        'last_seen': user.last_seen.isoformat() if user.last_seen else None,
        'is_online': is_really_online,
        'timestamp': datetime.utcnow().isoformat()
    })

def cleanup_idle_users():
    """Mark users as offline if they haven't been seen in 30 seconds (reduced from 1 minute)"""
    with app.app_context():
        thirty_seconds_ago = datetime.utcnow() - timedelta(seconds=30)
        idle_users = User.query.filter(
            User.is_online == True,
            User.last_seen < thirty_seconds_ago
        ).all()
        
        for user in idle_users:
            user.is_online = False
            db.session.commit()
            
            # FIXED: Use to=None instead of broadcast=True
            socketio.emit('user_status', {
                'user_id': user.id,
                'status': 'offline',
                'username': user.username,
                'timestamp': datetime.utcnow().isoformat(),
                'reason': 'idle',
                'instant': True
            }, to=None)  # Changed from broadcast=True
            
            print(f"⏰ Marked idle user {user.username} as offline (last seen: {user.last_seen})")

@socketio.on('test_ping')
def handle_test_ping(data):
    """Test SocketIO connection"""
    if current_user.is_authenticated:
        emit('test_pong', {
            'status': 'ok', 
            'timestamp': data.get('timestamp'),
            'server_time': datetime.utcnow().isoformat(),
            'user_id': current_user.id,
            'username': current_user.username
        })
    else:
        emit('test_pong', {
            'status': 'error',
            'message': 'User not authenticated'
        })

@socketio.on('send_message')
def handle_send_message(data):
    """Handle sending a chat message via Socket.IO - UPDATED"""
    print(f"\n🔵 SOCKET.IO MESSAGE SEND:")
    print(f"   From: {current_user.id} ({current_user.username})")
    
    if not current_user.is_authenticated:
        print("❌ Not authenticated")
        emit('send_message_error', {
            'error': 'Not authenticated',
            'temp_id': data.get('temp_id')
        })
        return
    
    receiver_id = data.get('receiver_id')
    content = data.get('content', '').strip()
    temp_id = data.get('temp_id')
    
    if not receiver_id or not content:
        print("❌ Missing receiver_id or content")
        emit('send_message_error', {
            'error': 'Missing receiver_id or content',
            'temp_id': temp_id
        })
        return
    
    try:
        receiver_id = int(receiver_id)
        
        # Check for duplicate
        duplicate = check_for_duplicate_message(current_user.id, receiver_id, content, 2)
        if duplicate:
            print(f"🔄 DUPLICATE DETECTED (Socket.IO): Message ID {duplicate.id}")
            if temp_id:
                emit('message_delivered', {
                    'temp_id': temp_id,
                    'message_id': duplicate.id,
                    'timestamp': duplicate.timestamp.isoformat() + 'Z',
                    'status': duplicate.status
                })
            return
        
        # Check friendship
        friendship = Friend.query.filter(
            ((Friend.user_id == current_user.id) & (Friend.friend_id == receiver_id)) |
            ((Friend.user_id == receiver_id) & (Friend.friend_id == current_user.id))
        ).filter_by(status='accepted').first()
        
        if not friendship:
            print("❌ Users are not friends")
            emit('send_message_error', {
                'error': 'Users are not friends',
                'temp_id': temp_id
            })
            return
        
        # Check receiver online status
        receiver = User.query.get(receiver_id)
        is_receiver_online = receiver and receiver.is_online
        
        # Set initial status
        initial_status = 'delivered' if is_receiver_online else 'sent'
        
        # Create message
        message = ChatMessage(
            sender_id=current_user.id,
            receiver_id=receiver_id,
            content=content,
            status=initial_status,
            is_read=False
        )
        db.session.add(message)
        db.session.flush()
        
        # Create notification
        notification = Notification(
            user_id=receiver_id,
            text=f"💬 New message from {current_user.username}",
            link=f"/chat/{current_user.id}"
        )
        db.session.add(notification)
        db.session.commit()
        
        print(f"✅ Message saved: ID={message.id}, Status={initial_status}")
        
        # Prepare message data
        message_data = {
            'id': message.id,
            'sender_id': current_user.id,
            'sender_username': current_user.username,
            'receiver_id': receiver_id,
            'content': content,
            'timestamp': message.timestamp.isoformat() + 'Z',
            'is_read': False,
            'status': initial_status
        }
        
        # Emit to receiver
        emit('new_message', message_data, room=f'user_{receiver_id}')
        print(f"✅ Emitted to user_{receiver_id}")
        
        # Send delivery confirmation to sender
        if temp_id:
            emit('message_delivered', {
                'temp_id': temp_id,
                'message_id': message.id,
                'timestamp': message.timestamp.isoformat() + 'Z',
                'status': initial_status
            })
            print(f"✅ Confirmation sent with temp_id: {temp_id}")
        
    except Exception as e:
        print(f"❌ ERROR in handle_send_message: {e}")
        import traceback
        traceback.print_exc()
        emit('send_message_error', {
            'error': 'Internal server error',
            'temp_id': temp_id
        })

@socketio.on('user_leaving')
def handle_user_leaving(data):
    """Handle when user explicitly leaves the chat"""
    if current_user.is_authenticated:
        print(f"👋 User {current_user.username} is leaving chat")
        current_user.is_online = False
        current_user.last_seen = datetime.utcnow()
        db.session.commit()
        
        socketio.emit('user_status', {
            'user_id': current_user.id, 
            'status': 'offline',
            'username': current_user.username,
            'timestamp': datetime.utcnow().isoformat(),
            'reason': 'left_chat'
        }, to=None) 

@socketio.on('disconnect')
def handle_disconnect():
    """Handle user disconnection - WITH DELAY TO PREVENT PREMATURE OFFLINE"""
    if current_user.is_authenticated:
        print(f"❌ User {current_user.username} disconnected (Socket ID: {request.sid})")
        
        import time
        time.sleep(2)  

        current_user.is_online = False
        current_user.last_seen = datetime.utcnow()
        db.session.commit()
        
        # Get all friends to notify them IMMEDIATELY
        friendships = Friend.query.filter(
            ((Friend.user_id == current_user.id) | (Friend.friend_id == current_user.id)) &
            (Friend.status == 'accepted')
        ).all()
        
        # Send immediate offline status to all friends
        for friendship in friendships:
            friend_id = friendship.friend_id if friendship.user_id == current_user.id else friendship.user_id
            
            socketio.emit('user_status', {
                'user_id': current_user.id, 
                'status': 'offline',
                'username': current_user.username,
                'timestamp': datetime.utcnow().isoformat(),
                'reason': 'disconnected',
                'instant': True  # Mark as instant update
            }, room=f'user_{friend_id}')
        
        print(f"✅ Broadcasted immediate offline status for {current_user.username}")

@socketio.on('request_status')
def handle_status_request(data):
    """Handle status check requests"""
    if current_user.is_authenticated:
        user_id = data.get('user_id')
        
        if user_id:
            user = User.query.get(user_id)
            if user:
                # Check if user is actually online (connected in last 2 minutes)
                two_minutes_ago = datetime.utcnow() - timedelta(minutes=2)
                is_really_online = user.is_online and user.last_seen > two_minutes_ago
                
                # Update if incorrectly marked as online
                if user.is_online and not is_really_online:
                    user.is_online = False
                    db.session.commit()
                
                emit('status_response', {
                    'user_id': user.id,
                    'status': 'online' if is_really_online else 'offline',
                    'timestamp': datetime.utcnow().isoformat()
                })

def cleanup_idle_users():
    """Mark users as offline if they haven't been seen in 30 seconds (reduced from 1 minute)"""
    with app.app_context():
        thirty_seconds_ago = datetime.utcnow() - timedelta(seconds=30)
        idle_users = User.query.filter(
            User.is_online == True,
            User.last_seen < thirty_seconds_ago
        ).all()
        
        for user in idle_users:
            user.is_online = False
            db.session.commit()
            
            # FIXED: Use to=None instead of broadcast=True
            socketio.emit('user_status', {
                'user_id': user.id,
                'status': 'offline',
                'username': user.username,
                'timestamp': datetime.utcnow().isoformat(),
                'reason': 'idle',
                'instant': True
            }, to=None)  # Changed from broadcast=True
            
            print(f"⏰ Marked idle user {user.username} as offline (last seen: {user.last_seen})")

@socketio.on('join_chat')
def handle_join_chat(data):
    """Join a chat room"""
    if current_user.is_authenticated:
        user_id = data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
                
                # Create a unique room for this chat
                room_name = f"chat_{min(current_user.id, user_id)}_{max(current_user.id, user_id)}"
                join_room(room_name)
                
                # Also ensure user is in their personal room
                join_room(f'user_{current_user.id}')
                
                emit('chat_joined', {
                    'room': room_name,
                    'user_id': user_id,
                    'current_user_id': current_user.id
                })
                
                print(f"✅ User {current_user.id} joined chat with {user_id}")
                
            except Exception as e:
                print(f"Error in handle_join_chat: {e}")
                emit('chat_error', {'error': 'Invalid user ID'})

@socketio.on('typing')
def handle_typing(data):
    """Handle typing indicator"""
    if not current_user.is_authenticated:
        return
    
    receiver_id = data.get('receiver_id')
    is_typing = data.get('is_typing', False)
    
    if not receiver_id:
        return
    
    try:
        receiver_id = int(receiver_id)
        
        # Emit to the chat room
        room_name = f"chat_{min(current_user.id, receiver_id)}_{max(current_user.id, receiver_id)}"
        
        emit('user_typing', {
            'user_id': current_user.id,
            'username': current_user.username,
            'is_typing': is_typing
        }, room=room_name, include_self=False)
        
    except Exception as e:
        print(f"Error in handle_typing: {e}")

@socketio.on('mark_read')
def handle_mark_read(data):
    """Mark messages as read and update status - UPDATED"""
    if not current_user.is_authenticated:
        return
    
    sender_id = data.get('sender_id')
    
    if not sender_id:
        return
    
    try:
        sender_id = int(sender_id)
        
        # Find unread messages
        unread_messages = ChatMessage.query.filter_by(
            sender_id=sender_id,
            receiver_id=current_user.id,
            is_read=False
        ).all()
        
        message_ids = []
        for msg in unread_messages:
            msg.is_read = True
            msg.status = 'read'  # CRITICAL: Update status too!
            message_ids.append(msg.id)
        
        db.session.commit()
        
        print(f"📖 SOCKET: Marked {len(unread_messages)} messages from {sender_id} as read")
        
        if unread_messages:
            # IMMEDIATELY notify sender with updated status
            for msg_id in message_ids:
                socketio.emit('message_status_update', {
                    'message_id': msg_id,
                    'status': 'read',
                    'timestamp': datetime.utcnow().isoformat() + 'Z'
                }, room=f'user_{sender_id}')
            
            # Also send bulk notification
            socketio.emit('messages_read', {
                'reader_id': current_user.id,
                'reader_username': current_user.username,
                'sender_id': sender_id,
                'count': len(unread_messages),
                'message_ids': message_ids,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }, room=f'user_{sender_id}')
        
    except Exception as e:
        print(f"❌ Error in handle_mark_read: {e}")
        db.session.rollback()

@socketio.on('friend_request')
def handle_friend_request(data):
    """Handle friend request notification"""
    if current_user.is_authenticated:
        receiver_id = data.get('receiver_id')
        
        if receiver_id:
            emit('friend_request', {
                'from': current_user.username,
                'from_id': current_user.id,
                'timestamp': datetime.utcnow().isoformat()
            }, room=f'user_{receiver_id}')

@socketio.on('new_snap')
def handle_new_snap(data):
    """Handle new snap notification"""
    if current_user.is_authenticated:
        receiver_id = data.get('receiver_id')
        
        if receiver_id:
            emit('new_snap', {
                'from': current_user.username,
                'from_id': current_user.id,
                'timestamp': datetime.utcnow().isoformat()
            }, room=f'user_{receiver_id}')

@socketio.on('message_delivered')
def handle_message_delivered(data):
    """Update message status to delivered when receiver comes online"""
    if not current_user.is_authenticated:
        return
    
    message_id = data.get('message_id')
    
    if not message_id:
        return
    
    try:
        # Find message (current user should be the receiver)
        message = ChatMessage.query.get(message_id)
        if message and message.receiver_id == current_user.id:
            # Only update if not already read
            if message.status != 'read':
                message.status = 'delivered'
                db.session.commit()
                
                # Notify sender
                socketio.emit('message_status_update', {
                    'message_id': message_id,
                    'status': 'delivered',
                    'timestamp': datetime.utcnow().isoformat() + 'Z'
                }, room=f'user_{message.sender_id}')
                
                print(f"✅ Message {message_id} marked as delivered")
    
    except Exception as e:
        print(f"❌ Error in handle_message_delivered: {e}")

@socketio.on('message_status_update')
def handle_message_status_update(data):
    """Forward status updates to frontend"""
    message_id = data.get('message_id')
    status = data.get('status')
    
    if message_id and status:
        # Get message to find sender
        message = ChatMessage.query.get(message_id)
        if message:
            # Emit to sender
            emit('message_status_update', {
                'message_id': message_id,
                'status': status,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }, room=f'user_{message.sender_id}')

@socketio.on('request_delivery_status')
def handle_delivery_status_request(data):
    """Handle request to check delivery status of pending messages"""
    if not current_user.is_authenticated:
        return
    
    message_ids = data.get('message_ids', [])
    receiver_id = data.get('receiver_id')
    
    if not message_ids or not receiver_id:
        return
    
    # Check if receiver is online
    receiver = User.query.get(receiver_id)
    is_receiver_online = receiver and receiver.is_online
    
    # For each message, check if it should be marked as delivered
    for message_id in message_ids:
        message = ChatMessage.query.get(message_id)  # CHANGED
        if message and message.sender_id == current_user.id:
            # If receiver is online, message is delivered
            status = 'delivered' if is_receiver_online else 'sent'
            
            emit('delivery_status_response', {
                'message_id': message_id,
                'status': status,
                'receiver_online': is_receiver_online,
                'timestamp': datetime.utcnow().isoformat()
            })

# Socket.IO event handlers for message operations
@socketio.on('message_deleted')
def handle_message_deleted(data):
    """Handle message deletion notification"""
    message_id = data.get('message_id')
    
    # Forward to receiver
    emit('message_deleted', data, room=f'user_{data.get("deleted_for_id", "")}')

@socketio.on('message_edited')
def handle_message_edited(data):
    """Handle message edit notification"""
    message_id = data.get('message_id')
    
    # Forward to receiver
    emit('message_edited', data, room=f'user_{data.get("edited_for_id", "")}')

# Helper function to update notification badge
def update_notification_badge():
    """Update notification badge count in session"""
    if current_user.is_authenticated:
        count = Notification.query.filter_by(
            user_id=current_user.id,
            is_read=False
        ).count()
        
        # Emit to user's room for real-time update
        socketio.emit('notification_count_update', {
            'count': count
        }, room=f'user_{current_user.id}')

import threading
import time

def start_cleanup_scheduler():
    """Start a background thread to cleanup idle users"""
    def cleanup_loop():
        while True:
            try:
                cleanup_idle_users()
            except Exception as e:
                print(f"Error in cleanup: {e}")
            time.sleep(60) 

    cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
    cleanup_thread.start()
    print("✅ Started idle user cleanup scheduler")

# Start cleanup scheduler when app starts
start_cleanup_scheduler()

def send_verification_email(email, otp):
    """Send verification email - WORKING VERSION"""
    try:
        print(f"📧 Attempting to send verification email to: {email}")
        print(f"🔢 OTP: {otp}")
        
        msg = Message(
            'Verify Your HabitHero Account',
            recipients=[email],
            sender=app.config['MAIL_DEFAULT_SENDER']
        )
        
        # Simple HTML email that definitely works
        msg.html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }}
                .content {{ background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }}
                .otp-code {{ 
                    background-color: #4F46E5; 
                    color: white; 
                    padding: 15px; 
                    font-size: 24px; 
                    font-weight: bold; 
                    text-align: center; 
                    letter-spacing: 5px;
                    border-radius: 5px;
                    margin: 20px 0;
                }}
                .footer {{ margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>HabitHero</h2>
                    <p>Email Verification Required</p>
                </div>
                <div class="content">
                    <h3>Hello!</h3>
                    <p>Please use the verification code below to complete your registration:</p>
                    
                    <div class="otp-code">{otp}</div>
                    
                    <p>This verification code will expire in {app.config['OTP_EXPIRY_MINUTES']} minutes.</p>
                    
                    <p>If you didn't request this verification, please ignore this email.</p>
                    
                    <div class="footer">
                        <p>This is an automated message from HabitHero. Please do not reply to this email.</p>
                        <p>© {datetime.utcnow().year} HabitHero. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
        
        # Plain text version for email clients that don't support HTML
        msg.body = f"""HabitHero Email Verification

Hello!

Your verification code is: {otp}

This code will expire in {app.config['OTP_EXPIRY_MINUTES']} minutes.

If you didn't request this verification, please ignore this email.

--
This is an automated message from HabitHero.
© {datetime.utcnow().year} HabitHero. All rights reserved.
"""
        
        mail.send(msg)
        print(f"✅ Verification email sent successfully to {email}")
        return True
        
    except Exception as e:
        print(f"❌ ERROR sending verification email: {e}")
        print(f"📧 Email was: {email}")
        print(f"🔢 OTP was: {otp}")
        
        # Log detailed error
        import traceback
        traceback.print_exc()
        
        # For development: Still show OTP in console
        print(f"\n{'='*60}")
        print(f"⚠️ EMAIL SENDING FAILED - USE THIS OTP FOR DEVELOPMENT")
        print(f"📧 Email: {email}")
        print(f"🔢 OTP: {otp}")
        print(f"{'='*60}\n")
        
        return False 
    
def send_password_reset_email(email, token, username=None):
    """Send password reset email"""
    try:
        reset_url = url_for('reset_password', token=token, _external=True)
        
        msg = Message(
            'Reset Your HabitHero Password',
            recipients=[email],
            sender=app.config['MAIL_DEFAULT_SENDER']
        )
        
        msg.html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }}
                .content {{ background-color: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }}
                .button {{ 
                    background-color: #4F46E5; 
                    color: white; 
                    padding: 12px 24px; 
                    text-decoration: none; 
                    border-radius: 5px;
                    display: inline-block;
                    margin: 20px 0;
                }}
                .footer {{ margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>HabitHero</h2>
                    <p>Password Reset Request</p>
                </div>
                <div class="content">
                    <h3>Hello{' ' + username if username else ''}!</h3>
                    <p>We received a request to reset your password. Click the button below to create a new password:</p>
                    
                    <p>
                        <a href="{reset_url}" class="button">Reset Password</a>
                    </p>
                    
                    <p>Or copy and paste this link into your browser:</p>
                    <p><code>{reset_url}</code></p>
                    
                    <p>This link will expire in {app.config['PASSWORD_RESET_EXPIRY_MINUTES']} minutes.</p>
                    
                    <p>If you didn't request a password reset, please ignore this email.</p>
                    
                    <div class="footer">
                        <p>This is an automated message from HabitHero. Please do not reply to this email.</p>
                        <p>© {datetime.utcnow().year} HabitHero. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.body = f"""HabitHero Password Reset

Hello{' ' + username if username else ''}!

We received a request to reset your password. Use the link below to create a new password:

{reset_url}

This link will expire in {app.config['PASSWORD_RESET_EXPIRY_MINUTES']} minutes.

If you didn't request a password reset, please ignore this email.

--
This is an automated message from HabitHero.
© {datetime.utcnow().year} HabitHero. All rights reserved.
"""
        
        mail.send(msg)
        print(f"✅ Password reset email sent to {email}")
        return True
        
    except Exception as e:
        print(f"❌ ERROR sending password reset email: {e}")
        return False

@app.route('/favicon.ico')
def favicon():
    """Serve the favicon"""
    return send_from_directory(
        os.path.join(app.root_path, 'static'),
        'favicon.ico',
        mimetype='image/vnd.microsoft.icon'
    )

from admin import init_admin, add_admin_field_to_user, create_default_admin_user

with app.app_context():
    db.create_all()
    print("✓ Database tables created successfully")
    
    add_admin_field_to_user(db)
    
    create_default_admin_user(app, db, models)
    
    print("✓ Flask-Admin initialized")
    
if __name__ == '__main__':
    host = '0.0.0.0'  
    port = 5000
    
    print(f"✓ App starting on:")
    print(f"  Local: http://localhost:{port}")
    
    # Get actual IP address
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
        print(f"  Network: http://{local_ip}:{port}")
    except:
        local_ip = 'localhost'
        print(f"  Network: Could not detect IP - use 'ipconfig' to find it")
    
    # Simple run command - this should work
    socketio.run(app, debug=True, host=host, port=port)
