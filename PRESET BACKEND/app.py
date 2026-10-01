from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import razorpay
import os
import hmac
import hashlib
import uuid
import smtplib
from email.message import EmailMessage

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]}})

# Razorpay credentials
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
MAIL_FROM = os.getenv("MAIL_FROM", SMTP_USERNAME)

if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
    raise RuntimeError("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env")

client = razorpay.Client(
    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
)


def send_download_email(email, items):
    if not all((SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, MAIL_FROM)):
        raise RuntimeError("SMTP email settings are missing in .env")

    message = EmailMessage()
    message["Subject"] = "Your Gene Academy preset downloads"
    message["From"] = MAIL_FROM
    message["To"] = email
    links = "\n".join(f"- {item['name']} (x{item.get('quantity', 1)}): {item['download_url']}" for item in items)
    message.set_content(f"Thanks for your purchase from Gene Academy!\n\nYour preset download links:\n{links}\n\nThese digital links are ready to use.")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(message)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


# Create Razorpay order
@app.route("/create-order", methods=["POST"])
def create_order():

    data = request.get_json(silent=True) or {}
    amount = data.get("amount")

    if not isinstance(amount, (int, float)) or amount <= 0:
        return jsonify({"error": "amount must be a positive number in INR"}), 400

    # Razorpay expects the amount in paise.
    amount_in_paise = round(amount * 100)

    order_data = {
        "amount": amount_in_paise,
        "currency": "INR",
        "receipt": f"gene_{uuid.uuid4().hex[:16]}"
    }

    order = client.order.create(data=order_data)

    return jsonify({
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "key_id": RAZORPAY_KEY_ID
    })


# Verify Razorpay payment
@app.route("/verify-payment", methods=["POST"])
def verify_payment():

    data = request.get_json(silent=True) or {}
    required_fields = ("razorpay_order_id", "razorpay_payment_id", "razorpay_signature")
    if any(not data.get(field) for field in required_fields):
        return jsonify({"success": False, "message": "Incomplete payment details"}), 400

    order_id = data["razorpay_order_id"]
    payment_id = data["razorpay_payment_id"]
    signature = data["razorpay_signature"]

    generated_signature = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256
    ).hexdigest()

    if hmac.compare_digest(generated_signature, signature):
        email = data.get("email")
        items = data.get("items") or []
        if not email or "@" not in email or not items or any(not item.get("download_url") for item in items):
            return jsonify({"success": False, "message": "Email and download links are required"}), 400
        try:
            send_download_email(email, items)
        except (OSError, smtplib.SMTPException, RuntimeError) as error:
            app.logger.exception("Payment verified but download email failed: %s", error)
            return jsonify({"success": False, "message": "Payment verified, but the download email could not be sent"}), 502

        return jsonify({
            "success": True,
            "message": "Payment verified successfully. Download links sent by email."
        })

    return jsonify({
        "success": False,
        "message": "Payment verification failed"
    }), 400


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")