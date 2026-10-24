# Guild

Protótipo independente de comunidades e chat.

## Executar localmente

Requer Node.js 22 ou superior. Na pasta do projeto:

```powershell
npm start
```

Abra <http://127.0.0.1:4173>. Crie uma conta com nome de 3 a 24 caracteres e senha com pelo menos 10 caracteres.

## Autenticação e dados

- Senhas são armazenadas como hashes scrypt com salt aleatório; a senha original não é salva.
- A sessão usa cookie HttpOnly e SameSite=Strict; em hospedagem com PORT, o cookie também exige HTTPS.
- Cada conta tem arquivo de estado separado e recebe apenas seus próprios eventos SSE.
- Usuários/senhas ficam em `users.json`; estado fica em `state-<id>.json` dentro do diretório persistente.
- Defina `GUILD_DATA_DIR` para o caminho do disco persistente na hospedagem.

## Limites atuais

As comunidades e conversas são privadas de cada conta e ainda não podem ser compartilhadas por convites. Não há recuperação de senha, verificação de e-mail, áudio/vídeo real, compartilhamento de tela nem armazenamento de anexos. O cadastro é aberto e ainda faltam ferramentas de administração/moderação. Não use para dados sensíveis.

Para Render: conecte este repositório como serviço Node; comando de build `npm install`, comando de início `npm start`. Configure um disco persistente e `GUILD_DATA_DIR` com o caminho de montagem do disco. O app pode iniciar sem disco, mas contas/dados não sobreviverão a reinícios ou substituições do serviço.

