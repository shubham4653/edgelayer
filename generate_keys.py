import rsa

print("Generating RSA keys... (this might take a few seconds)")

# Generate a 2048-bit key pair
public_key, private_key = rsa.newkeys(2048)

# Save the Private Key
with open("edge_private_key.pem", "wb") as f:
    f.write(private_key.save_pkcs1("PEM"))

# Save the Public Key
with open("edge_public_key.pem", "wb") as f:
    f.write(public_key.save_pkcs1("PEM"))

print("✅ Keys generated successfully!")