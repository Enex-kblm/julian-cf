#include <WiFi.h>
#include <PubSubClient.h>

// Ganti dengan kredensial WiFi kamu
const char* ssid = "your_SSID";
const char* password = "your_PASSWORD";

// Broker MQTT (Misalnya Mosquitto di VPS)
const char* mqttServer = "your_VPS_IP";
const int mqttPort = 1883;
const char* mqttUser = "mqtt_user"; // jika ada
const char* mqttPassword = "mqtt_password"; // jika ada

WiFiClient espClient;
PubSubClient client(espClient);

const int relayPin = 5; // Pin relay untuk menyalakan lampu

// Fungsi untuk menghubungkan ke WiFi
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }
  Serial.println("Connected to WiFi");
}

// Fungsi untuk menangani pesan yang diterima dari broker MQTT
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.print("Message received: ");
  Serial.println(message);

  // Perintah untuk menyalakan/mematikan lampu
  if (String(topic) == "lampu/kamar") {
    if (message == "ON") {
      digitalWrite(relayPin, HIGH); // Menyalakan lampu
      client.publish("status/lampu/kamar", "Lampu Kamar: ON");
    } else if (message == "OFF") {
      digitalWrite(relayPin, LOW); // Mematikan lampu
      client.publish("status/lampu/kamar", "Lampu Kamar: OFF");
    }
  }
}

void reconnect() {
  // Loop sampai terhubung ke broker MQTT
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("ESP32Client", mqttUser, mqttPassword)) {
      Serial.println("Connected to MQTT broker");
      client.subscribe("lampu/kamar"); // Subscribe ke topik perintah
    } else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  setup_wifi();
  
  client.setServer(mqttServer, mqttPort);
  client.setCallback(callback);

  pinMode(relayPin, OUTPUT); // Mengatur pin relay sebagai output
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
}
