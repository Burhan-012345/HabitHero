# admin.py - Fixed version with corrected template configuration
import os
from datetime import datetime, timedelta
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, send_file
from flask_admin import Admin, AdminIndexView, expose
from flask_admin.contrib.sqla import ModelView
from flask_login import current_user
from werkzeug.utils import secure_filename

# Create a blueprint for admin routes
admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

# We'll define these functions here but they'll be initialized later
admin_instance = None

def init_admin(app, db, models):
    """Initialize the admin panel with the app and database
    models: dictionary containing all model classes
    """
    global admin_instance
    
    # Extract models
    User = models.get('User')
    Habit = models.get('Habit')
    HabitLog = models.get('HabitLog')
    Friend = models.get('Friend')
    Snap = models.get('Snap')
    SnapReaction = models.get('SnapReaction')
    SavedSnap = models.get('SavedSnap')
    EmailVerificationOTP = models.get('EmailVerificationOTP')
    PasswordResetToken = models.get('PasswordResetToken')
    ChatMessage = models.get('ChatMessage')
    Notification = models.get('Notification')
    
    # Custom admin views for security
    class SecureModelView(ModelView):
        def is_accessible(self):
            return current_user.is_authenticated and hasattr(current_user, 'is_admin') and current_user.is_admin
        
        def inaccessible_callback(self, name, **kwargs):
            return redirect(url_for('login'))

    class UserAdminView(SecureModelView):
        column_list = ['id', 'username', 'email', 'is_verified', 'is_online', 'last_seen', 'created_at']
        column_searchable_list = ['username', 'email']
        column_filters = ['is_verified', 'is_online', 'created_at']
        column_sortable_list = ['id', 'username', 'email', 'created_at']
        form_columns = ['username', 'email', 'password_hash', 'is_verified', 'is_online', 'bio', 'avatar']
        
        # Override to hash password when creating/editing
        def on_model_change(self, form, model, is_created):
            if 'password_hash' in form.data and form.password_hash.data:
                from flask_bcrypt import Bcrypt
                bcrypt = Bcrypt(app)
                model.password_hash = bcrypt.generate_password_hash(form.password_hash.data).decode('utf-8')

    class HabitAdminView(SecureModelView):
        column_list = ['id', 'name', 'user', 'frequency', 'streak_count', 'best_streak', 'last_completed', 'created_at']
        column_filters = ['frequency', 'user_id']
        column_searchable_list = ['name']
        form_columns = ['name', 'description', 'frequency', 'user_id', 'streak_count', 'best_streak', 'last_completed']

    class HabitLogAdminView(SecureModelView):
        column_list = ['id', 'user', 'habit', 'completed_at', 'note']
        column_filters = ['completed_at']
        form_columns = ['user_id', 'habit_id', 'completed_at', 'note']

    class SnapAdminView(SecureModelView):
        column_list = ['id', 'sender', 'receiver', 'content_type', 'is_viewed', 'created_at', 'expires_at']
        column_filters = ['content_type', 'is_viewed']
        column_searchable_list = ['caption']
        form_columns = ['sender_id', 'receiver_id', 'habit_id', 'content_type', 'content', 'caption', 'is_viewed', 'expires_at']

    class SnapReactionAdminView(SecureModelView):
        column_list = ['id', 'snap', 'user', 'emoji', 'created_at']
        form_columns = ['snap_id', 'user_id', 'emoji']

    class SavedSnapAdminView(SecureModelView):
        column_list = ['id', 'user', 'snap', 'saved_at']
        form_columns = ['user_id', 'snap_id']

    class FriendAdminView(SecureModelView):
        column_list = ['id', 'user', 'friend', 'status', 'created_at']
        column_filters = ['status']
        form_columns = ['user_id', 'friend_id', 'status']

    class ChatMessageAdminView(SecureModelView):
        column_list = ['id', 'sender', 'receiver', 'content', 'timestamp', 'is_read', 'status']
        column_filters = ['is_read', 'status', 'timestamp']
        column_searchable_list = ['content']
        form_columns = ['sender_id', 'receiver_id', 'content', 'is_read', 'status']

    class NotificationAdminView(SecureModelView):
        column_list = ['id', 'user', 'text', 'link', 'is_read', 'timestamp']
        column_filters = ['is_read']
        column_searchable_list = ['text']
        form_columns = ['user_id', 'text', 'link', 'is_read']

    class CustomAdminIndexView(AdminIndexView):
        @expose('/')
        def index(self):
            """Admin dashboard view - FIXED version"""
            if not current_user.is_authenticated:
                return redirect(url_for('login'))
            
            # Check if user is admin
            if not hasattr(current_user, 'is_admin') or not current_user.is_admin:
                flash('Admin access required', 'danger')
                return redirect(url_for('dashboard'))
            
            # Get statistics
            stats = {
                'total_users': User.query.count(),
                'online_users': User.query.filter_by(is_online=True).count(),
                'total_habits': Habit.query.count(),
                'active_habits': Habit.query.filter(Habit.streak_count > 0).count(),
                'total_snaps': Snap.query.count(),
                'today_snaps': Snap.query.filter(
                    Snap.created_at >= datetime.utcnow().date()
                ).count(),
                'total_messages': ChatMessage.query.count(),
                'unread_messages': ChatMessage.query.filter_by(is_read=False).count(),
            }
            
            # Get recent users
            recent_users = User.query.order_by(User.created_at.desc()).limit(5).all()
            
            # Get recent snaps
            recent_snaps = Snap.query.order_by(Snap.created_at.desc()).limit(5).all()
            
            # Use self.render() from AdminIndexView
            return self.render('admin/index.html',
                             stats=stats,
                             recent_users=recent_users,
                             recent_snaps=recent_snaps,
                             now=datetime.utcnow()) 

    # CRITICAL FIX: Initialize Flask-Admin with proper template configuration
    admin_instance = Admin(app, 
                          name='HabitHero Admin',
                          template_mode='bootstrap3',
                          index_view=CustomAdminIndexView(name='Dashboard', url='/admin'),
                          base_template='admin/master.html') 
    
    # Add model views to admin
    admin_instance.add_view(UserAdminView(User, db.session, name='Users', category='User Management'))
    admin_instance.add_view(HabitAdminView(Habit, db.session, name='Habits', category='Content'))
    admin_instance.add_view(SecureModelView(HabitLog, db.session, name='Habit Logs', category='Content'))
    admin_instance.add_view(FriendAdminView(Friend, db.session, name='Friendships', category='Social'))
    admin_instance.add_view(SnapAdminView(Snap, db.session, name='Snaps', category='Content'))
    admin_instance.add_view(SecureModelView(SnapReaction, db.session, name='Snap Reactions', category='Content'))
    admin_instance.add_view(SecureModelView(SavedSnap, db.session, name='Saved Snaps', category='Content'))
    admin_instance.add_view(ChatMessageAdminView(ChatMessage, db.session, name='Messages', category='Social'))
    admin_instance.add_view(NotificationAdminView(Notification, db.session, name='Notifications', category='System'))
    admin_instance.add_view(SecureModelView(EmailVerificationOTP, db.session, name='Email OTPs', category='System'))
    admin_instance.add_view(SecureModelView(PasswordResetToken, db.session, name='Password Reset Tokens', category='System'))

    # Create admin template directory and files
    create_admin_templates(app)
    
    # Register admin routes
    register_admin_routes(app, db, models)
    
    print("✓ Flask-Admin initialized with template configuration")
    
    return admin_instance

def create_admin_templates(app):
    """Create admin template directory and files"""
    admin_template_dir = os.path.join(app.root_path, 'templates', 'admin')
    os.makedirs(admin_template_dir, exist_ok=True)
    
    # Create admin master template if it doesn't exist
    master_template = os.path.join(admin_template_dir, 'master.html')
    if not os.path.exists(master_template):
        with open(master_template, 'w') as f:
            f.write('''{% extends 'admin/base.html' %}

{% block body %}
  {{ super() }}
{% endblock %}
''')
    
    # Create custom admin index template
    index_template = os.path.join(admin_template_dir, 'index.html')
    if not os.path.exists(index_template):
        with open(index_template, 'w') as f:
            f.write('''{% extends 'admin/base.html' %}

{% block body %}
<div class="container-fluid">
    <h1>HabitHero Admin Dashboard</h1>
    
    <div class="row">
        <div class="col-md-3">
            <div class="card text-white bg-primary mb-3">
                <div class="card-body">
                    <h5 class="card-title">Total Users</h5>
                    <h2 class="card-text">{{ stats.total_users }}</h2>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card text-white bg-success mb-3">
                <div class="card-body">
                    <h5 class="card-title">Total Habits</h5>
                    <h2 class="card-text">{{ stats.total_habits }}</h2>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card text-white bg-info mb-3">
                <div class="card-body">
                    <h5 class="card-title">Total Snaps</h5>
                    <h2 class="card-text">{{ stats.total_snaps }}</h2>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card text-white bg-warning mb-3">
                <div class="card-body">
                    <h5 class="card-title">Online Users</h5>
                    <h2 class="card-text">{{ stats.online_users }}</h2>
                </div>
            </div>
        </div>
    </div>
    
    <div class="row">
        <div class="col-md-6">
            <div class="card">
                <div class="card-header">
                    <h5>Recent Users</h5>
                </div>
                <div class="card-body">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Joined</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {% for user in recent_users %}
                            <tr>
                                <td>{{ user.id }}</td>
                                <td>{{ user.username }}</td>
                                <td>{{ user.email }}</td>
                                <td>{{ user.created_at.strftime('%Y-%m-%d') }}</td>
                                <td>
                                    {% if user.is_verified %}
                                        <span class="badge badge-success">Verified</span>
                                    {% else %}
                                        <span class="badge badge-warning">Unverified</span>
                                    {% endif %}
                                    {% if user.is_online %}
                                        <span class="badge badge-primary">Online</span>
                                    {% endif %}
                                </td>
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <div class="col-md-6">
            <div class="card">
                <div class="card-header">
                    <h5>Recent Snaps</h5>
                </div>
                <div class="card-body">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Type</th>
                                <th>Sent</th>
                            </tr>
                        </thead>
                        <tbody>
                            {% for snap in recent_snaps %}
                            <tr>
                                <td>{{ snap.id }}</td>
                                <td>{{ snap.sender.username }}</td>
                                <td>{{ snap.receiver.username }}</td>
                                <td>
                                    {% if snap.content_type == 'image' %}
                                        <span class="badge badge-info">Image</span>
                                    {% elif snap.content_type == 'video' %}
                                        <span class="badge badge-warning">Video</span>
                                    {% else %}
                                        <span class="badge badge-secondary">Text</span>
                                    {% endif %}
                                </td>
                                <td>{{ snap.created_at.strftime('%Y-%m-%d %H:%M') }}</td>
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    
    <div class="row mt-4">
        <div class="col-md-12">
            <div class="card">
                <div class="card-header">
                    <h5>Quick Actions</h5>
                </div>
                <div class="card-body">
                    <a href="{{ url_for('admin_cleanup') }}" class="btn btn-outline-primary mr-2">Cleanup Utilities</a>
                    <a href="{{ url_for('admin_cleanup') }}" class="btn btn-outline-secondary mr-2">Admin Cleanup</a>
                    <a href="{{ url_for('admin_export_page') }}" class="btn btn-outline-success mr-2">Export Data</a>
                    <a href="{{ url_for('admin.index') }}" class="btn btn-outline-info">Refresh Dashboard</a>
                </div>
            </div>
        </div>
    </div>
</div>
{% endblock %}
''')

def register_admin_routes(app, db, models):
    """Register custom admin routes"""
    
    # Extract models
    User = models.get('User')
    Habit = models.get('Habit')
    HabitLog = models.get('HabitLog')
    Friend = models.get('Friend')
    Snap = models.get('Snap')
    SnapReaction = models.get('SnapReaction')
    SavedSnap = models.get('SavedSnap')
    EmailVerificationOTP = models.get('EmailVerificationOTP')
    PasswordResetToken = models.get('PasswordResetToken')
    ChatMessage = models.get('ChatMessage')
    Notification = models.get('Notification')
    
    @app.route('/admin/cleanup')
    def admin_cleanup():
        """Admin cleanup utilities"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            flash('Admin access required', 'danger')
            return redirect(url_for('login'))
        
        return """
        <h1>Admin Cleanup Utilities</h1>
        <ul>
            <li><a href="/admin/cleanup-expired-snaps">Cleanup Expired Snaps</a></li>
            <li><a href="/admin/cleanup-expired-otps">Cleanup Expired OTPs</a></li>
            <li><a href="/admin/cleanup-expired-tokens">Cleanup Expired Tokens</a></li>
            <li><a href="/admin/fix-offline-users">Fix Offline Users</a></li>
        </ul>
        """

    @app.route('/admin/cleanup-expired-otps')
    def cleanup_expired_otps():
        """Clean up expired OTPs"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            return 'Admin access required', 403
        
        expired_count = 0
        expired_otps = EmailVerificationOTP.query.filter(EmailVerificationOTP.expires_at < datetime.utcnow()).all()
        
        for otp in expired_otps:
            db.session.delete(otp)
            expired_count += 1
        
        db.session.commit()
        
        return f'Cleaned up {expired_count} expired OTPs'

    @app.route('/admin/cleanup-expired-tokens')
    def cleanup_expired_tokens():
        """Clean up expired password reset tokens"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            return 'Admin access required', 403
        
        expired_count = 0
        expired_tokens = PasswordResetToken.query.filter(PasswordResetToken.expires_at < datetime.utcnow()).all()
        
        for token in expired_tokens:
            db.session.delete(token)
            expired_count += 1
        
        db.session.commit()
        
        return f'Cleaned up {expired_count} expired tokens'

    @app.route('/admin/fix-offline-users')
    def fix_offline_users():
        """Fix users who are incorrectly marked as online"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            return 'Admin access required', 403
        
        # Mark users as offline if last_seen > 5 minutes ago
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        online_users = User.query.filter_by(is_online=True).all()
        
        fixed_count = 0
        for user in online_users:
            if user.last_seen and user.last_seen < five_minutes_ago:
                user.is_online = False
                fixed_count += 1
        
        db.session.commit()
        
        return f'Fixed {fixed_count} users incorrectly marked as online'

    @app.route('/admin/export')
    def admin_export_page():
        """Export data page"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            flash('Admin access required', 'danger')
            return redirect(url_for('login'))
        
        # Get export history (simulated)
        export_history = []
        
        return render_template('admin/export.html', 
                             export_history=export_history,
                             now=datetime.utcnow())

    @app.route('/admin/cleanup-page')
    def admin_cleanup_page():
        """Cleanup tools page"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            flash('Admin access required', 'danger')
            return redirect(url_for('login'))
        
        # Simulated data - you'd replace with actual queries
        stats = {
            'db_size': 15.5,
            'expired_count': 245,
            'inactive_users': 42,
            'storage_used': '2.3 GB',
            'expired_snaps': 150,
            'expired_otps': 65,
            'expired_tokens': 30,
            'unverified_users': 18
        }
        
        cleanup_logs = []
        
        return render_template('admin/cleanup.html',
                             stats=stats,
                             cleanup_logs=cleanup_logs)

    @app.route('/admin/deactivate-inactive-users', methods=['POST'])
    def deactivate_inactive_users():
        """Deactivate users inactive for 30+ days"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        inactive_users = User.query.filter(
            User.last_seen < thirty_days_ago,
            User.is_online == False
        ).all()
        
        count = 0
        for user in inactive_users:
            # You could mark them as inactive or deactivate them
            # For now, just count them
            count += 1
        
        return jsonify({'success': True, 'count': count})

    @app.route('/admin/delete-unverified-users', methods=['POST'])
    def delete_unverified_users():
        """Delete unverified user accounts"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        # Find users who signed up more than 7 days ago but never verified
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        unverified_users = User.query.filter(
            User.is_verified == False,
            User.created_at < seven_days_ago
        ).all()
        
        count = 0
        for user in unverified_users:
            db.session.delete(user)
            count += 1
        
        db.session.commit()
        
        return jsonify({'success': True, 'count': count})

def add_admin_field_to_user(db):
    """Add is_admin field to User table if it doesn't exist"""
    from sqlalchemy import inspect, text
    
    try:
        inspector = inspect(db.engine)
        columns = [col['name'] for col in inspector.get_columns('user')]
        
        if 'is_admin' not in columns:
            print("Adding 'is_admin' column to user table...")
            try:
                # Use SQLAlchemy 2.0 compatible syntax
                db.session.execute(text('ALTER TABLE user ADD COLUMN is_admin BOOLEAN DEFAULT FALSE'))
                db.session.commit()
                print("✓ Added 'is_admin' column to user table")
            except Exception as e:
                print(f"Error adding is_admin column: {e}")
                db.session.rollback()
    except Exception as e:
        print(f"Could not check for is_admin column: {e}")

def create_default_admin_user(app, db, models=None):
    """Create an admin user if none exists - FIXED version"""
    from flask_bcrypt import Bcrypt
    
    with app.app_context():
        try:
            # Get User model from models dictionary if provided
            User = None
            if models:
                User = models.get('User')
            else:
                # Try to import from app (fallback)
                try:
                    from app import User
                except ImportError:
                    print("❌ Could not import User model")
                    return
            
            if not User:
                print("❌ User model not found")
                return
            
            # Check if table exists by trying to query
            try:
                # This will fail if table doesn't exist
                User.query.first()
            except Exception as e:
                print(f"❌ User table doesn't exist yet: {e}")
                return
            
            admin_user = User.query.filter_by(email='admin@habithero.com').first()
            if not admin_user:
                bcrypt = Bcrypt(app)
                # Create admin user
                admin_user = User(
                    username='admin',
                    email='admin@habithero.com',
                    password_hash=bcrypt.generate_password_hash('Burhan@01').decode('utf-8'),
                    is_verified=True,
                    is_admin=True
                )
                db.session.add(admin_user)
                db.session.commit()
                print("✓ Created admin user: admin@habithero.com / Burhan@01")
            else:
                # Ensure admin user has is_admin=True
                if not admin_user.is_admin:
                    admin_user.is_admin = True
                    db.session.commit()
                    print("✓ Updated existing user as admin")
                else:
                    print("✓ Admin user already exists")
                    
        except Exception as e:
            print(f"❌ Error creating admin user: {e}")
            import traceback
            traceback.print_exc()

# File management routes for admin
def register_file_routes(app):
    """Register file management routes for admin"""
    
    @app.route('/admin/file/list')
    def file_list():
        """List files in a directory"""
        if not current_user.is_authenticated or not hasattr(current_user, 'is_admin') or not current_user.is_admin:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        path = request.args.get('path', '/uploads')
        full_path = os.path.join(app.config['UPLOAD_FOLDER'], path.lstrip('/'))
        
        if not os.path.exists(full_path):
            return jsonify({'success': False, 'message': 'Path not found'}), 404
        
        files = []
        for item in os.listdir(full_path):
            item_path = os.path.join(full_path, item)
            stat = os.stat(item_path)
            
            files.append({
                'name': item,
                'path': os.path.join(path, item),
                'type': 'directory' if os.path.isdir(item_path) else 'file',
                'size': stat.st_size if os.path.isfile(item_path) else 0,
                'modified': stat.st_mtime,
                'permissions': oct(stat.st_mode)[-3:]
            })
        
        return jsonify({'success': True, 'files': files})

    @app.route('/admin/file/preview')
    def file_preview():
        """Preview a file"""
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        path = request.args.get('path')
        if not path:
            return jsonify({'success': False, 'message': 'Path required'}), 400
        
        full_path = os.path.join(app.config['UPLOAD_FOLDER'], path.lstrip('/'))
        
        if not os.path.exists(full_path):
            return jsonify({'success': False, 'message': 'File not found'}), 404
        
        stat = os.stat(full_path)
        
        # Determine file type
        if os.path.isdir(full_path):
            file_type = 'directory'
        elif path.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp')):
            file_type = 'image'
        elif path.lower().endswith(('.txt', '.md', '.html', '.css', '.js', '.py', '.json', '.xml')):
            file_type = 'text'
        elif path.lower().endswith('.pdf'):
            file_type = 'pdf'
        else:
            file_type = 'other'
        
        response_data = {
            'success': True,
            'type': file_type,
            'url': f'/uploads/{path.lstrip("/")}',
            'info': {
                'name': os.path.basename(path),
                'path': path,
                'size': stat.st_size,
                'type': file_type,
                'modified': stat.st_mtime,
                'permissions': oct(stat.st_mode)[-3:]
            }
        }
        
        # Read text files for preview
        if file_type == 'text' and stat.st_size < 1024 * 1024:  # 1MB limit
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    response_data['content'] = f.read()
            except:
                response_data['content'] = '[Binary file or encoding not supported]'
        
        return jsonify(response_data)

    @app.route('/admin/file/stats')
    def file_stats():
        """Get storage statistics"""
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
        
        import shutil
        
        total, used, free = shutil.disk_usage(app.config['UPLOAD_FOLDER'])
        
        # Count files and folders
        file_count = 0
        folder_count = 0
        for root, dirs, files in os.walk(app.config['UPLOAD_FOLDER']):
            file_count += len(files)
            folder_count += len(dirs)
        
        return jsonify({
            'success': True,
            'totalSpace': f'{total // (2**30)} GB',
            'usedSpace': f'{used // (2**30)} GB',
            'freeSpace': f'{free // (2**30)} GB',
            'usedPercent': round((used / total) * 100, 1),
            'fileCount': file_count,
            'folderCount': folder_count
        })

# Make functions available
__all__ = ['init_admin', 'add_admin_field_to_user', 'create_default_admin_user']