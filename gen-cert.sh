#!/bin/bash
# Generate self-signed TLS certificate for wmux

# Create .wmux directory if it doesn't exist
CERT_DIR="${HOME}/.wmux"
mkdir -p "${CERT_DIR}"

CERT_FILE="${CERT_DIR}/wmux.crt"
KEY_FILE="${CERT_DIR}/wmux.key"
DAYS=3650  # 10 years

echo "Generating self-signed TLS certificate for wmux..."
echo "Certificate will be saved to: ${CERT_DIR}"

# Get Tailscale IP if available
TAILSCALE_IP=$(ip addr show tailscale0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)

if [ -z "$TAILSCALE_IP" ]; then
    echo "Warning: Tailscale IP not found, using localhost"
    TAILSCALE_IP="127.0.0.1"
fi

echo "Using IP: $TAILSCALE_IP"

# Generate certificate
openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days $DAYS \
    -subj "/CN=wmux" \
    -addext "subjectAltName=IP:$TAILSCALE_IP,IP:127.0.0.1,DNS:localhost"

if [ $? -eq 0 ]; then
    echo ""
    echo "Certificate generated successfully:"
    echo "  Certificate: $CERT_FILE"
    echo "  Private key: $KEY_FILE"
    echo "  Valid for: $DAYS days"
    echo ""
    echo "Start wmux with TLS:"
    echo "  ./wmux --tls"
    echo ""
    echo "Note: Your browser will show a security warning for self-signed certificates."
    echo "      Click 'Advanced' and 'Proceed' to accept the certificate."
else
    echo "Error generating certificate"
    exit 1
fi
