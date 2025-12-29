# migrate_database_fixed.py
from app import app, db
from sqlalchemy import inspect, text, Table, MetaData
import os

def add_column_if_not_exists(table_name, column_name, column_type):
    """Add a column to a table if it doesn't exist"""
    inspector = inspect(db.engine)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    
    if column_name not in columns:
        print(f"Adding {column_name} column to {table_name} table...")
        try:
            db.session.execute(text(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}'))
            print(f"✓ Added {column_name} column to {table_name}")
            return True
        except Exception as e:
            print(f"✗ Error adding {column_name}: {e}")
            return False
    else:
        print(f"✓ {column_name} column already exists in {table_name}")
        return True

def create_table_if_not_exists(table_name, create_sql):
    """Create a table if it doesn't exist"""
    inspector = inspect(db.engine)
    
    if table_name not in inspector.get_table_names():
        print(f"Creating {table_name} table...")
        try:
            db.session.execute(text(create_sql))
            print(f"✓ Created {table_name} table")
            return True
        except Exception as e:
            print(f"✗ Error creating {table_name}: {e}")
            return False
    else:
        print(f"✓ {table_name} table already exists")
        return True

def main():
    print("Starting database migration...")
    
    try:
        # Add columns to snap table
        add_column_if_not_exists('snap', 'reply_to_id', 'INTEGER')
        add_column_if_not_exists('snap', 'is_saved', 'BOOLEAN DEFAULT FALSE')
        
        # Create saved_snap table
        saved_snap_sql = '''
            CREATE TABLE saved_snap (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                snap_id INTEGER NOT NULL,
                saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, snap_id)
            )
        '''
        create_table_if_not_exists('saved_snap', saved_snap_sql)
        
        # Try to create foreign key (SQLite has limitations, so we'll skip if it fails)
        try:
            print("Attempting to add foreign key constraint...")
            # SQLite doesn't support adding foreign keys with ALTER TABLE
            # We need to check if it already exists
            inspector = inspect(db.engine)
            foreign_keys = inspector.get_foreign_keys('snap')
            has_reply_fk = any(fk['constrained_columns'] == ['reply_to_id'] for fk in foreign_keys)
            
            if not has_reply_fk:
                print("Note: SQLite doesn't support adding foreign keys via ALTER TABLE")
                print("The column has been added, but foreign key constraint cannot be added automatically")
        except Exception as e:
            print(f"Note: Could not check/apply foreign key constraint: {e}")
        
        db.session.commit()
        print("✓ Database migration completed successfully!")
        
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        db.session.rollback()

if __name__ == '__main__':
    with app.app_context():
        main()