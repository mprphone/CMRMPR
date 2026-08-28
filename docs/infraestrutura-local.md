# Infraestrutura local CMRMPR

## Arquitetura

- `https://cmr.mpr.pt`: aplicação CMR e API Supabase local, publicadas por Nginx.
- `https://wa.mpr.pt`: WAMPR existente.
- Supabase self-hosted: `/mnt/bunker/CMRMPR/supabase-local`.
- Base SQLite do WAMPR: `/mnt/bunker/MPRWA/whatsapp.db`.
- O WAMPR é a fonte dos campos comuns de clientes e colaboradores. O CMR preserva os seus campos financeiros, seguros, tarefas e restantes dados próprios.
- O worker do WAMPR envia um snapshot assinado para a Edge Function local. A chave de integração é distinta das credenciais de utilizador e não é enviada para o navegador.
- A antiga ligação de importação ao Supabase externo está desativada no build de produção. O CMR usa exclusivamente o Supabase local.
- O CMR já pode funcionar sem o Supabase externo antigo. Contudo, o WAPRO ainda tem dependências remotas próprias (pedidos, modelos de obrigações e algumas rotas SAF-T/Storage), pelo que o projeto remoto não deve ser desligado integralmente antes de essas dependências serem migradas e testadas.
- O stack Supabase local em `/mnt/bunker/CMRMPR/supabase-local` não pode ser desligado: ele contém o PostgreSQL, autenticação, API e Storage do CMR.
- A sincronização local WAPRO → CMR continua necessária porque o WAPRO usa SQLite e o CMR usa PostgreSQL. É automática; o botão manual serve apenas para recuperação/validação e só aparece a utilizadores autorizados.
- O bucket `attachments` é privado. Apólices e documentos SAF-T são disponibilizados por links assinados com validade de 15 minutos e só depois de validar as permissões e o âmbito de dados. O logótipo público reside separadamente em `public-assets`.

Os serviços de base de dados e gateway só escutam em `127.0.0.1`. Nginx publica apenas a aplicação e as rotas padrão `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1` e `/graphql/v1`. Todas as respostas do domínio levam HSTS/CSP/`X-Frame-Options`, e `/auth/v1/token` e as restantes rotas de API têm `limit_req` (instalar também `deploy/nginx/cmr-rate-limit.conf` em `/etc/nginx/conf.d/`, que declara as zonas usadas por `cmr.mpr.pt.conf`).

## Operação

```bash
# Estado do Supabase local
cd /mnt/bunker/CMRMPR/supabase-local
sudo docker compose -f docker-compose.yml -f docker-compose.cmrmpr.yml ps

# Estado do WAMPR
systemctl status mprwa-backend.service

# Estado do sincronismo (a chave não deve ser impressa ou copiada para logs)
curl -sS http://127.0.0.1:3010/api/integrations/cmrmpr/status \
  -H "x-cmr-integration-key: $(sed -n 's/^CMR_INTEGRATION_API_KEY=//p' /home/ubuntu/programas/mprWA/.env)"
```

O sincronismo automático é controlado por `CMR_SYNC_ENABLED` em `/home/ubuntu/programas/mprWA/.env`. Depois de alterar esse valor, reiniciar `mprwa-backend.service`.

## Utilizadores e permissões

Um administrador configura os acessos em **Configurações → Utilizadores e permissões**. É possível definir módulos e ações, ativar/desativar a conta, limitar a clientes atribuídos ou selecionados, associar um colaborador e autorizar separadamente dados financeiros, comissões, sincronização e gestão de utilizadores.

No mesmo painel, um administrador pode criar uma conta local e redefinir a respetiva palavra-passe. As palavras-passe temporárias exigem pelo menos 12 caracteres, maiúscula, minúscula e número, não são devolvidas pela API e nunca são guardadas no frontend.

Cada utilizador pode ativar TOTP em **Configurações → Segurança da sua conta**. Depois de confirmar o QR code, o segundo fator torna-se obrigatório no frontend, nas Edge Functions e através de uma política restritiva em todas as tabelas RLS. Uma sessão `aal1` deixa de conseguir ler ou alterar dados enquanto existir um fator verificado.

As regras não são apenas filtros visuais: são validadas pelas políticas RLS e funções do PostgreSQL. Custos, avenças, faturação, lucro e salários são ainda mascarados nas respostas da API e as colunas financeiras não podem ser lidas diretamente sem autorização. A função de sincronização também verifica a autorização do utilizador. Nunca atribuir `can_manage_users`, `can_view_financial` ou `can_sync_wampr` sem necessidade operacional.

## Caixa, seguros e auditoria SQL

- Pagamentos, acordos, saídas, fechos, apólices e liquidações de comissões são gravados no PostgreSQL local.
- O CMR não cria novas saídas de caixa apenas no navegador. Se o PostgreSQL estiver indisponível, mostra erro e bloqueia o fecho.
- A gravação e remoção de marcações de pagamentos é feita por uma única transação SQL.
- O fecho valida e bloqueia em simultâneo pagamentos e despesas, confirma os totais do relatório e reverte tudo se houver conflito.
- Pagamentos e despesas já fechados e o próprio fecho são imutáveis para utilizadores da aplicação.
- Restrições SQL impedem meses, métodos, montantes, taxas, datas, frequências e estados inválidos. Os meses `100` e seguintes são referências intencionais às prestações de acordos de dívida antiga.
- Todas as inserções, alterações e eliminações de caixa e seguros ficam no histórico imutável `financial_audit_log`, com utilizador, instante, registo anterior e novo e transação.

## Monitorização

**Configurações → Estado e proteção dos dados** verifica a base local, a fila automática WAPRO → CMR e o último backup. A aplicação volta a verificar a cada cinco minutos e mostra um aviso persistente aos administradores quando existe fila com falhas, sincronização atrasada ou backup ausente/antigo.

## Publicação do frontend

Usar sempre o build local, que lê a chave pública `ANON_KEY` da instalação Supabase e desativa a antiga importação remota:

```bash
cd /home/ubuntu/programas/CMPRMPR
npm run build:local
sudo rsync -a --delete dist/ /var/www/cmrmpr/
```

Não usar o build genérico para publicar em produção. O teste de navegador pode ser repetido com `npm run verify:public`, fornecendo `CMR_E2E_EMAIL` e `CMR_E2E_PASSWORD` apenas no ambiente do processo.

Antes de publicar, executar também `npx tsc --noEmit` e `npm audit --omit=dev --audit-level=high`. Uma publicação só deve avançar sem erros TypeScript e sem vulnerabilidades de nível alto/crítico.

## Backups

`cmrmpr-backup.timer` executa diariamente às 02:30 UTC, com atraso aleatório até 15 minutos. Cada pasta em `/mnt/bunker/CMRMPR/backups` contém:

- dump completo do PostgreSQL e respetivos roles;
- cópia transacional e validada do SQLite WAMPR;
- objetos do Storage e Edge Functions;
- código-fonte das duas aplicações e frontend CMR publicado;
- configuração Docker, ambiente protegido e configuração Nginx;
- manifesto e hashes SHA-256.

São conservados 30 dias. As pastas e ficheiros são acessíveis apenas a `root`.

O script regista ainda `running`, `success` ou `error` em `app_config.system_backup_health`. O painel considera anómalo um backup sem sucesso há mais de 36 horas.

Se `CMRMPR_BACKUP_GPG_RECIPIENT` estiver definido no ambiente do serviço (chave pública GPG), a pasta final é cifrada para `AAAAMMDDTHHMMSSZ.tar.gpg` e a versão em claro é removida; sem esta variável o comportamento mantém-se (pasta em claro, só protegida por permissões 0600/0700).

`cmrmpr-backup.service` tem `OnFailure=cmrmpr-backup-alert@%n.service`: instalar também `deploy/systemd/cmrmpr-backup-alert@.service` e `deploy/backup/cmrmpr-backup-alert` (em `/usr/local/sbin/`) para que uma falha registe sempre um aviso `crit` no journal e um `wall` às sessões locais. Para um alerta também fora da máquina, definir `CMRMPR_ALERT_WEBHOOK_URL` em `/mnt/bunker/CMRMPR/backups/.alert.env` (0600, só root).

```bash
systemctl list-timers cmrmpr-backup.timer
sudo systemctl start cmrmpr-backup.service
journalctl -u cmrmpr-backup.service --since today
```

## Recuperação

Antes de recuperar, parar o sincronismo no WAMPR (`CMR_SYNC_ENABLED=false`) e fazer uma cópia adicional do estado atual.

1. Se a pasta foi cifrada (`AAAAMMDDTHHMMSSZ.tar.gpg`), correr primeiro `gpg --decrypt AAAAMMDDTHHMMSSZ.tar.gpg | tar -x` para recuperar a pasta em claro.
2. Verificar `sha256sum -c SHA256SUMS` dentro da pasta escolhida.
3. Restaurar a configuração e arrancar uma instância Supabase limpa da mesma versão.
4. Restaurar os roles com `psql` e a base com `pg_restore --clean --if-exists`.
5. Restaurar `supabase-storage.tar.gz` em `volumes/storage` antes de iniciar o serviço Storage.
6. Substituir o SQLite apenas com o serviço WAMPR parado e confirmar `PRAGMA integrity_check`.
7. Arrancar os serviços, executar os testes públicos e só depois reativar o sincronismo.

Nunca restaurar diretamente por cima dos serviços ativos. As credenciais em `supabase.env` e nos dumps devem manter permissões `0600`.
