# The throwaway test space. Tools an agent would normally have, plus strace for evidence.
# There is no internet here, so anything an honest skill commonly needs must already be installed.
FROM debian:bookworm-slim
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      bash ca-certificates coreutils curl file findutils git grep jq less make nodejs openssl poppler-utils procps \
      python3 python3-bs4 python3-docx python3-lxml python3-markdown python3-openpyxl python3-pandas python3-pil \
      python3-pip python3-pypdf python3-reportlab python3-requests python3-yaml sed sqlite3 strace \
      tar unzip wget zip \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --quiet --no-cache-dir --break-system-packages python-pptx pdfplumber
RUN useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir -p /workspace /trace && chown agent:agent /workspace && chmod 700 /trace
WORKDIR /workspace
