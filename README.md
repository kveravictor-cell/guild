# Guild

Guild é um protótipo independente de comunidades e chat, inspirado em aplicativos de comunidade.

## Estado atual

Este repositório ainda contém apenas a interface e um servidor de protótipo. O servidor não implementa contas, login, permissões por comunidade, moderação nem salas de voz reais. Ele compartilha o estado entre todos os visitantes. **Não implante esta versão em um endereço público.**

Antes de abrir o app para outras pessoas, precisamos adicionar autenticação, isolamento dos dados de cada usuário/comunidade e controles de acesso. Voz e compartilhamento de tela exigem também sinalização e WebRTC; HTTPS é necessário para captura de tela no navegador.

## Executar localmente

Requer Node.js 22 ou superior. Na pasta do projeto:

```powershell
npm start
```

Abra http://127.0.0.1:4173. Os dados ficam em `guild-data/state.json`.

## Arquivos

- `discord-inspired.html`: interface do protótipo.
- `guild-server.js`: servidor Node.js e sincronização local.
