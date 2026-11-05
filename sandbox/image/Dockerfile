# The throwaway test space. Tools an agent would normally have, plus strace for evidence.
FROM debian:bookworm-slim
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      bash ca-certificates coreutils curl file findutils git grep jq nodejs procps python3 sed strace tar \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir -p /workspace /trace && chown agent:agent /workspace && chmod 700 /trace
WORKDIR /workspace
