# Studio MV

Site institucional e painel administrativo (`/boss`) da Studio MV.

## Estrutura
- `index.html`: site público.
- `logo.png`: logo oficial, usada no site e no painel.
- `_redirects`: envia `/adm` para `/boss` na Cloudflare Pages.
- `boss/index.html`, `boss/styles.css`, `boss/app.js`: painel administrativo.
- `supabase/schema.sql`: tabelas, regras de acesso (RLS), funções, histórico e arquivos.

## Configuração (fazer antes de publicar)
1. No Supabase, rode `supabase/schema.sql` inteiro no SQL Editor. Pode ser executado de novo sem erro. Para habilitar as notificações em tempo real após uma atualização do esquema, execute a versão mais recente do arquivo.
2. Em **Authentication > Users**, crie o usuário `studiomvcontato@gmail.com` com senha forte e confirme o e-mail.
3. Em **Authentication > Sign In / Providers**, desative **Allow new users to sign up**.
4. Em **Authentication > URL Configuration**, use o endereço publicado do site como Site URL e adicione `<endereço>/boss/` em Redirect URLs. Isso faz o link de recuperação de senha funcionar.
5. Em `index.html` e em `boss/app.js`, troque `SUPABASE_URL` e `SUPABASE_KEY` pelos dados do projeto (Project Settings > API). Use somente a chave **publishable**. Nunca use a chave `service_role`.
6. Para usar o cadastro de membros, publique a Edge Function `supabase/functions/member-admin` com `supabase functions deploy member-admin`. O Supabase fornece `SUPABASE_SERVICE_ROLE_KEY` automaticamente à função; não tente cadastrá-la manualmente nem coloque essa chave no site ou no repositório.

Na área **Add. Membro**, crie cada conta com e-mail e senha inicial, escolha a função e ajuste as permissões por módulo. A visão geral e as configurações ficam exclusivas do administrador. Cada membro vê somente as próprias tarefas e pode marcá-las como concluídas; a administração acompanha o status no perfil do membro. Remover um membro exclui a conta e as tarefas associadas.

Com o painel aberto, administradores recebem alertas de novas mensagens e de tarefas concluídas; membros recebem alertas de tarefas atribuídas. Clique em **Ativar som e alertas** e permita as notificações do navegador para habilitar o som e os avisos na área de trabalho.

## Publicação
A Cloudflare Pages publica a pasta na raiz do repositório a cada `git push` na branch principal. Não há comando de build.

## Limites conhecidos
- Listas carregam até 1.000 registros (limite padrão do Supabase). Para mais, será preciso paginar.
- A galeria de fotos do portfólio ainda não existe: cada projeto tem uma imagem de capa.
- Os pagamentos são registrados manualmente. Nada é marcado como recebido automaticamente.
