from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    """User model for storing Google OAuth users"""
    __tablename__ = 'users'
    
    id = db.Column(db.String(255), primary_key=True)  # Google ID
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(255))
    picture = db.Column(db.String(500))
    role = db.Column(db.String(50), default='user')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    cart_items = db.relationship('CartItem', backref='user', lazy=True, cascade='all, delete-orphan')
    orders = db.relationship('Order', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'picture': self.picture,
            'role': self.role,
            'created_at': self.created_at.isoformat(),
            'last_login': self.last_login.isoformat()
        }
    
    def __repr__(self):
        return f'<User {self.email}>'


class CartItem(db.Model):
    """Cart items for each user"""
    __tablename__ = 'cart_items'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(255), db.ForeignKey('users.id'), nullable=False, index=True)
    preset_name = db.Column(db.String(255), nullable=False)
    preset_type = db.Column(db.String(50))
    category = db.Column(db.String(50))
    tone = db.Column(db.String(50))
    price = db.Column(db.Float, nullable=False)
    quantity = db.Column(db.Integer, default=1)
    image = db.Column(db.String(500))
    video = db.Column(db.String(500))
    color = db.Column(db.String(50))
    added_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'preset_name': self.preset_name,
            'preset_type': self.preset_type,
            'category': self.category,
            'tone': self.tone,
            'price': self.price,
            'quantity': self.quantity,
            'image': self.image,
            'video': self.video,
            'color': self.color,
            'added_at': self.added_at.isoformat()
        }
    
    def __repr__(self):
        return f'<CartItem {self.preset_name} x{self.quantity}>'


class Order(db.Model):
    """Order history"""
    __tablename__ = 'orders'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(255), db.ForeignKey('users.id'), nullable=False, index=True)
    razorpay_order_id = db.Column(db.String(255), unique=True)
    razorpay_payment_id = db.Column(db.String(255), unique=True)
    total_amount = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(50), default='pending')  # pending, completed, failed
    items_json = db.Column(db.Text)  # Store items as JSON
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'razorpay_order_id': self.razorpay_order_id,
            'razorpay_payment_id': self.razorpay_payment_id,
            'total_amount': self.total_amount,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
    
    def __repr__(self):
        return f'<Order {self.id} - {self.status}>'
