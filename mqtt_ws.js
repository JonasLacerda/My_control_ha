const WebSocket = require('ws');
const mqtt = require('mqtt');

let estadosRequestId = null;
let shoppingListRequestId = null;
let entidadesAtuais = {}; // Mapear entidades por ID
let aguardandoRespostaMQTT = false;


function entidades() {
    estadosRequestId = sendMessage('get_states');
}

function controlarSwitch(entityId, ligar = true) {
  const servico = ligar ? 'turn_on' : 'turn_off';

  sendMessage('call_service', {
    domain: 'switch',
    service: servico,
    service_data: {
      entity_id: entityId
    }
  });

  console.log(`⚡ Enviado comando para ${servico} ${entityId}`);
}

const compras = {
  ids: {}, // Para mapear nomes aos IDs (opcional, para facilitar uso por nome)

  listar() {
    this.listRequestId = sendMessage('shopping_list/items');
  },

  adicionar(nome) {
    sendMessage('shopping_list/add_item', { name: nome });
    console.log(`➕ Adicionando "${nome}" à lista de compras`);
  },

  concluir(idOuNome) {
    const id = this.ids[idOuNome] || idOuNome;
    sendMessage('shopping_list/update_item', {
      item_id: id,
      name: null,      // manter o mesmo nome
      complete: true
    });
    console.log(`✅ Marcando "${idOuNome}" como concluído`);
  },

  remover(idOuNome) {
    const id = this.ids[idOuNome] || idOuNome;
    sendMessage('shopping_list/remove_item', {
      item_id: id
    });
    console.log(`❌ Removendo "${idOuNome}" da lista`);
  }
};

const config = {
    host: process.env.HA_HOST,
    port: process.env.HA_PORT || 8123,
    token: process.env.HA_TOKEN
  };
  
  const configmqtt = {
    broker: process.env.MQTT_BROKER,
    topic: process.env.MQTT_TOPIC || 'node/cmd',
    options: {
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS
    }
  };
  

const mqttClient = mqtt.connect(configmqtt.broker, configmqtt.options)

mqttClient.on('connect', () => {
  console.log('Conectado ao broker MQTT');
  mqttClient.subscribe(configmqtt.topic, (err) => {
    if (!err) console.log(`Inscrito no tópico: ${configmqtt.topic}`);
  });
});

mqttClient.on("message", (topic, message) => {
  const texto = message.toString().trim();
  console.log(message.toString() + " - " + topic.toString());

  if (message.toString() === "interruptor") {
    if (texto === "interruptor") {
      // Para cada interruptor, envie individualmente
      Object.entries(entidadesAtuais)
        .filter(([id]) => id.startsWith("switch."))
        .forEach(([id, { name, state }]) => {
          const switchData = {
            id,
            name,
            state
          };

          // Publicar o interruptor individualmente
          console.log("Enviando interruptor: " + JSON.stringify(switchData));
          mqttClient.publish('node/status/interruptores', JSON.stringify([switchData]), { qos: 0, retain: false });
          console.log(`📤 Enviado interruptor: ${name} (${state}) via MQTT`);
        });

      // Para o WebSocket ou outro fluxo
      estadosRequestId = sendMessage('get_states');
      aguardandoRespostaMQTT = true; // Sinaliza que foi pedido via MQTT
    }
  }
});


// URL de conexão WebSocket
const wsUrl = `ws://${config.host}:${config.port}/api/websocket`;

// Criar cliente WebSocket
const client = new WebSocket(wsUrl);

// Variável para controlar o ID das mensagens
let messageId = 1;

// Função para enviar mensagens com ID auto-incrementável
function sendMessage(type, data = {}) {
  const message = {
    id: messageId++,
    type,
    ...data
  };
  client.send(JSON.stringify(message));
  return message.id;
}

// Manipuladores de eventos
client.on('open', () => {
  console.log('Conectado ao WebSocket do Home Assistant');
  
  // Enviar mensagem de autenticação SEM ID (formato especial)
  const authMsg = {
    type: 'auth',
    access_token: config.token
  };
  client.send(JSON.stringify(authMsg));
});

client.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    
    //console.log('📨 Mensagem recebida:', JSON.stringify(message, null, 2));
    
    // Tratar resposta de autenticação
    if (message.type === 'auth_ok') {
      console.log('✅ Autenticado com sucesso!');
      
      // Subscrever a eventos após autenticação
      sendMessage('subscribe_events', {
        event_type: 'state_changed'
      });
      
      // Obter estados iniciais
      //sendMessage('get_states');
      //controlarSwitch("switch.1001e8341e_1", false)
      compras.listar()
      entidades()
      return;
    }
    
    if (message.type === 'auth_invalid') {
      console.error('❌ Falha na autenticação:', message.message);
      client.close();
      return;
    }
    
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
  }
});

mqttClient.on('message', (topic, message) => {
  const payload = message.toString().trim();

  if (payload.startsWith("switch.")) {
    const [entityId, stateStr] = payload.split(' ').map(s => s.trim());
    const isOn = stateStr === 'true';

    console.log(`Switch ID: ${entityId}, Ligado: ${isOn}`);
    controlarSwitch(entityId, isOn);
  }
});

client.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.event?.event_type === 'state_changed') {
    const ent = msg.event.data.new_state;
    const entity = ent.entity_id;
    const oldState = msg.event.data.old_state.state;
    const newState = ent.state;
    const name = ent.attributes?.friendly_name || entity; // usa o nome amigável, ou o entity_id se não tiver
  
    console.log(`${entity}, ${newState}`);
  
    // Publica no MQTT
    const payload = JSON.stringify([
      {
        id: entity,
        name: name,
        state: newState
      }
    ]);
    mqttClient.publish('node/status/interruptores', payload);
    
    // Exemplo: Alertar se um switch ficar unavailable
    if (newState === 'unavailable') {
      console.warn(`⚠️ Dispositivo ${entity} ficou indisponível!`);
    }
  }

  // Resposta do get_states
  if (msg.type === 'result' && msg.id === estadosRequestId && msg.success) {
    entidadesAtuais = {}; // Atualiza lista
    const switches = [];
  
    msg.result.forEach(ent => {
      const id = ent.entity_id;
      const name = ent.attributes.friendly_name || '(sem nome)';
      const state = ent.state;
      entidadesAtuais[id] = { name, state };
  
      if (id.startsWith("switch.")) {
        switches.push({ id, name, state });
      }
  
      console.log(`${id}, ${name}, ${state}`);
    });
  
    // Se veio do MQTT, publica a resposta
    if (aguardandoRespostaMQTT) {
      mqttClient.publish('node/status/interruptores', JSON.stringify(switches));
      console.log(`📤 Enviado lista de interruptores (${switches.length}) via MQTT`);
      aguardandoRespostaMQTT = false;
    }
  
    return;
  }
  

  if (msg.type === 'result' && msg.id === compras.listRequestId && msg.success) {
    console.log('🛒 Lista de Compras:');
    compras.ids = {}; // Limpa o mapeamento de nomes para IDs

    msg.result.forEach(item => {
      const status = item.complete ? '  ✔️' : ' 🟡';
      console.log(`${status} ${item.name} (id: ${item.id})`);
      compras.ids[item.name] = item.id; // Atualiza o mapa nome -> id
    });
  }
});

client.on('close', () => {
  console.log('🔌 Conexão WebSocket fechada');
  setTimeout(() => {
    console.log('🔄 Tentando reconectar...');
    new WebSocket(wsUrl);
  }, 5000);
});

client.on('error', (err) => {
  console.error('❌ Erro na conexão:', err.message);
});

