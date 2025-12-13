import os, json, time, traceback
from dotenv import load_dotenv
import requests
import pika

load_dotenv()

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://api-gateway:3000")
FCM_SERVER_KEY = os.getenv("FCM_SERVER_KEY", "")

MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))

def send_push_fcm(token, title, body, data=None):
    if not FCM_SERVER_KEY:
        raise Exception("no_fcm_key")
    url = "https://fcm.googleapis.com/fcm/send"
    headers = {"Authorization": f"key={FCM_SERVER_KEY}", "Content-Type":"application/json"}
    payload = {"to": token, "notification": {"title": title, "body": body}, "data": data or {}}
    r = requests.post(url, json=payload, headers=headers, timeout=5)
    if r.status_code not in (200,201):
        raise Exception(f"fcm_error_{r.status_code}_{r.text}")
    return r.json()

def update_status(request_id, status, error=None):
    payload = {
        "notification_id": request_id,
        "status": status,
        "timestamp": None,
        "error": error
    }
    try:
        resp = requests.post(f"{GATEWAY_URL}/api/v1/notifications/status", json=payload, timeout=5)
        return resp.status_code, resp.text
    except Exception as e:
        print("Failed to update status to gateway:", e)
        return None, str(e)

def process_message(body):
    request_id = body.get("request_id")
    user_id = body.get("user_id")
    template_code = body.get("template_code")
    variables = body.get("variables", {})

    # fetch user
    r = requests.get(f"http://user-service:3001/api/v1/users/{user_id}", timeout=5)
    if r.status_code != 200:
        raise Exception(f"user_lookup_failed: {r.status_code} {r.text}")
    user = r.json().get("data")
    token = user.get("push_token")
    if not token:
        raise Exception("no_push_token")

    # render template
    r2 = requests.post(f"http://template-service:3002/api/v1/templates/{template_code}/render", json={"variables": variables}, timeout=5)
    if r2.status_code != 200:
        raise Exception(f"template_render_failed: {r2.status_code} {r2.text}")
    rendered = r2.json().get("data")
    title = rendered.get("subject", "")
    body_text = rendered.get("body", "")

    # send - demo mode logs when FCM key absent
    if FCM_SERVER_KEY:
        send_push_fcm(token, title, body_text, variables)
    else:
        print("FCM key missing, test mode: push would be sent:", token, title, body_text)

def on_message(ch, method, properties, body):
    payload = json.loads(body)
    attempt = payload.get("_attempt", 0)
    request_id = payload.get("request_id")
    try:
        print("Processing push:", request_id, "attempt:", attempt)
        process_message(payload)
        update_status(request_id, "delivered", None)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        print("Push error:", e)
        traceback.print_exc()
        attempt += 1
        if attempt >= MAX_RETRIES:
            try:
                conn = pika.BlockingConnection(pika.URLParameters(RABBITMQ_URL))
                ch2 = conn.channel()
                ch2.queue_declare(queue="failed.queue", durable=True)
                payload["_attempt"] = attempt
                ch2.basic_publish(exchange="", routing_key="failed.queue", body=json.dumps(payload), properties=pika.BasicProperties(delivery_mode=2))
                conn.close()
            except Exception as ex:
                print("Failed to publish to failed.queue:", ex)
            update_status(request_id, "failed", str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            backoff = 2 ** attempt
            time.sleep(backoff)
            try:
                conn = pika.BlockingConnection(pika.URLParameters(RABBITMQ_URL))
                ch3 = conn.channel()
                ch3.queue_declare(queue="push.queue", durable=True)
                payload["_attempt"] = attempt
                ch3.basic_publish(exchange="", routing_key="push.queue", body=json.dumps(payload), properties=pika.BasicProperties(delivery_mode=2))
                conn.close()
            except Exception as ex:
                print("Failed to republish push for retry:", ex)
            ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    params = pika.URLParameters(RABBITMQ_URL)
    while True:
        try:
            conn = pika.BlockingConnection(params)
            channel = conn.channel()
            channel.queue_declare(queue='push.queue', durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue='push.queue', on_message_callback=on_message)
            print("Push consumer started, waiting for messages...")
            channel.start_consuming()
        except Exception as e:
            print("Connection error in push consumer, retrying in 5s:", e)
            time.sleep(5)

if __name__ == "__main__":
    main()
