FROM node:18

# Instala o jq (necessário para o run.sh processar JSON)
RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*

# Criar diretório da aplicação
WORKDIR /app

# Copiar os arquivos
COPY mqtt_ws.js .
COPY run.sh .
COPY config.json .

# Instalar dependências
RUN npm install ws mqtt

# Tornar o script executável
RUN chmod +x run.sh

# Executar o script
CMD [ "./run.sh" ]