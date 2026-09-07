# Expo SDK 53 builder — built on top of the Android base.
# Pushed to GHCR as ghcr.io/charfeddineaz/apk-expo-builder:sdk53
FROM ghcr.io/charfeddineaz/apk-android-builder:latest

# Pin Expo to the SDK 53 toolchain expectations.
RUN npm install -g expo@^53.0.0 && expo --version

WORKDIR /build
CMD ["bash"]
