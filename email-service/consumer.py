import os
import json
import time
import traceback
from dotenv import load_dotenv
import requests
from email.message import EmailMessage
import smtplib
import pika

load_dotenv()

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
GATEWAY = os.getenv("GATEWAY_URL", "http://api-gateway:3000")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.example")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", None)
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", None)
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))


def send_mail(to_email, subject, body):
    msg = EmailMessage()
    msg["From"] = SMTP_USER or "no-reply@example"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
        s.starttls()
        if SMTP_USER and SMTP_PASSWORD:
            s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)


def update_status(request_id, status, error=None):
    payload = {
        "notification_id": request_id,
        "status": status,
        "timestamp": None,
        "error": error,
    }
    try:
        resp = requests.post(
            f"{GATEWAY}/api/v1/notifications/status", json=payload, timeout=5)
        return resp.status_code, resp.text()
    except Exception as e:
        print("Failed to update status to gateway:", e)


def process_message(body):
    request_id = body.get("request_id")
    user_id = body.get("user_id")
    template_code = body.get("template_code")
    variables = body.get("variables", {})

    r = requests.get(
    f"http://user-service:3001/api/v1/users/{user_id}", timeout=5)
    if r.status_code != 200:
        raise Exception(f"user_lookup_failed: {r.status_code} {r.text}")
    user = r.json().get("data")
    email = user.get("email")

    r2 = requests.post(
        f"http://template-service:3002/api/v1/templates/{template_code}/render", json={"variables": variables}, timeout=5)
    if r2.status_code != 200:
        raise Exception(f"template_render_failed: {r2.status_code}, {r2.text}")
    rendered = r2.json().get("data")
    subject = rendered.get("subject", "")
    body_text = rendered.get("body", "")

    send_mail(email, subject, body_text)


def on_message(ch, method, properties, body):
    payload = json.loads(body)
    attempt = payload.get("_attempt", 0)
    request_id = payload.get("request_id")
    try:
        print("Processing:", request_id, "attempt:", attempt)
        process_message(payload)

        update_status(request_id, "delivered", None)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        print("Error sending:", e)
        traceback.print_exc()
        attempt += 1
        if attempt >= MAX_RETRIES:
            print("Max attempts reached. Sending to failed.queue")
            try:
                conn = pika.BlockingConnection(
                    pika.URLParameters(RABBITMQ_URL))
                ch2 = conn.channel()
                ch2.queue_declare(queue="failed.queue", durable=True)
                payload = dict(payload)
                payload["_attempt"] = attempt
                ch2.basic_publish(exchange="", routing_key="failed.queue", body=json.dumps(
                    payload), properties=pika.BasicProperties(delivery_mode=2))
                conn.close()
            except Exception as ex:
                print("Failed to publish to failed.queue:", ex)
            update_status(request_id, "failed", str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            backoff = 2 ** attempt
            print(f"Retrying in {backoff}s")
            time.sleep(backoff)
            try:
                conn = pika.BlockingConnection(
                    pika.URLParameters(RABBITMQ_URL))
                ch3 = conn.channel()
                ch3.queue_declare(queue="email.queue", durable=True)
                payload = dict(payload)
                payload["_attempt"] = attempt
                ch3.basic_publish(exchange="", routing_key="email.queue", body=json.dumps(
                    payload), properties=pika.BasicProperties(delivery_mode=2))
                conn.close()
            except Exception as ex:
                print("Failed to republish for retry:", ex)
            ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    params = pika.URLParameters(RABBITMQ_URL)
    while True:
        try:
            conn = pika.BlockingConnection(params)
            channel = conn.channel()
            channel.queue_declare(queue='email.queue', durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue='email.queue',
                                  on_message_callback=on_message)
            print("Email consumer started, waiting for messages...")
            channel.start_consuming()
        except Exception as e:
            print("Connection error, retrying in 5s:", e)
            time.sleep(5)


if __name__ == "__main__":
    main()
