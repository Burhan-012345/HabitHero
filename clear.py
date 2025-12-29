#!/usr/bin/env python3
"""
Script to clear chat messages from HabitHero database.
Usage: python clear_chat_messages.py [options]
"""

import os
import sys
import click
from datetime import datetime, timedelta

# Add the app directory to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, db
from app import ChatMessage, User

@click.command()
@click.option('--all', is_flag=True, help='Clear ALL chat messages')
@click.option('--user-id', type=int, help='Clear messages for specific user ID')
@click.option('--username', type=str, help='Clear messages for specific username')
@click.option('--older-than', type=int, help='Clear messages older than X days')
@click.option('--dry-run', is_flag=True, help='Show what would be deleted without actually deleting')
@click.option('--confirm', is_flag=True, help='Skip confirmation prompt')
def main(all, user_id, username, older_than, dry_run, confirm):
    """Clear chat messages from the database."""
    
    with app.app_context():
        try:
            # Build query
            query = ChatMessage.query
            
            if user_id:
                user = User.query.get(user_id)
                if not user:
                    print(f"❌ User with ID {user_id} not found.")
                    return
                query = query.filter(
                    (ChatMessage.sender_id == user_id) | 
                    (ChatMessage.receiver_id == user_id)
                )
                print(f"🔍 Found user: {user.username} (ID: {user.id})")
                
            elif username:
                user = User.query.filter_by(username=username).first()
                if not user:
                    print(f"❌ User '{username}' not found.")
                    return
                user_id = user.id
                query = query.filter(
                    (ChatMessage.sender_id == user_id) | 
                    (ChatMessage.receiver_id == user_id)
                )
                print(f"🔍 Found user: {user.username} (ID: {user.id})")
                
            elif older_than:
                cutoff_date = datetime.utcnow() - timedelta(days=older_than)
                query = query.filter(ChatMessage.timestamp < cutoff_date)
                print(f"🗑️  Clearing messages older than {older_than} days (before {cutoff_date})")
            
            # Count messages to be deleted
            message_count = query.count()
            
            if message_count == 0:
                print("✅ No messages found matching the criteria.")
                return
            
            # Show preview
            print("\n" + "="*60)
            print(f"📊 MESSAGE CLEARING SUMMARY")
            print("="*60)
            
            if user_id or username:
                user_obj = user if 'user' in locals() else User.query.get(user_id) if user_id else None
                user_name = user_obj.username if user_obj else f"ID {user_id}"
                print(f"👤 User: {user_name}")
            
            if older_than:
                print(f"📅 Age: Older than {older_than} days")
            
            print(f"📨 Messages to delete: {message_count}")
            
            # Get some sample messages
            sample_messages = query.order_by(ChatMessage.timestamp.desc()).limit(5).all()
            if sample_messages:
                print("\n📋 Sample messages (most recent):")
                for i, msg in enumerate(sample_messages, 1):
                    sender = User.query.get(msg.sender_id)
                    receiver = User.query.get(msg.receiver_id)
                    time_str = msg.timestamp.strftime('%Y-%m-%d %H:%M')
                    preview = msg.content[:50] + "..." if len(msg.content) > 50 else msg.content
                    print(f"  {i}. [{time_str}] {sender.username} → {receiver.username}: {preview}")
            
            print("\n" + "="*60)
            
            if dry_run:
                print("🏃 DRY RUN - No messages were actually deleted.")
                return
            
            # Ask for confirmation
            if not confirm:
                response = input(f"\n❓ Are you sure you want to delete {message_count} chat messages? (y/N): ")
                if response.lower() != 'y':
                    print("❌ Operation cancelled.")
                    return
            
            # Delete messages
            print(f"\n🗑️  Deleting {message_count} messages...")
            deleted_count = query.delete()
            db.session.commit()
            
            print(f"✅ Successfully deleted {deleted_count} chat messages.")
            
        except Exception as e:
            db.session.rollback()
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()

if __name__ == '__main__':
    main()