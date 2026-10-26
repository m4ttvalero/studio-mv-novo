-- Studio MV · Esquema completo (Supabase)
-- Execute tudo de uma vez no SQL Editor. Pode ser executado novamente sem erro.

-- ===================================================================
-- 1. ADMINISTRADORES E FUNÇÃO DE ACESSO
-- ===================================================================
create table if not exists public.admins (
  email text primary key
);

-- Retorna verdadeiro somente para o e-mail do usuário logado que está em public.admins.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===================================================================
-- 2. CLIENTES
-- ===================================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  company text check (company is null or char_length(company) <= 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or char_length(phone) <= 30),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 30),
  instagram text check (instagram is null or char_length(instagram) <= 80),
  address text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evita dois clientes com o mesmo e-mail.
create unique index if not exists clients_email_unique
  on public.clients (lower(email))
  where email is not null and email <> '';

-- ===================================================================
-- 3. PROJETOS E ETAPAS
-- ===================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  client_id uuid not null references public.clients(id) on delete restrict,
  service text,
  description text,
  agreed_value numeric(12,2) not null default 0 check (agreed_value >= 0),
  start_date date,
  due_date date,
  status text not null default 'Aguardando início'
    check (status in ('Aguardando início','Em andamento','Aguardando aprovação do cliente','Em ajustes','Concluído','Entregue','Cancelado')),
  progress smallint not null default 0 check (progress between 0 and 100),
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_check check (due_date is null or start_date is null or due_date >= start_date)
);

create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ===================================================================
-- 4. FILA DE ESPERA
-- ===================================================================
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  service text,
  description text,
  estimated_value numeric(12,2) check (estimated_value is null or estimated_value >= 0),
  entry_date date not null default current_date,
  priority integer not null default 0,
  expected_start date,
  notes text,
  state text not null default 'Na fila' check (state in ('Na fila','Movido para projeto')),
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===================================================================
-- 5. SOLICITAÇÕES DO FORMULÁRIO DO SITE
-- ===================================================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  company text not null check (char_length(company) between 2 and 120),
  email text not null check (char_length(email) between 5 and 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text not null check (char_length(phone) between 8 and 30),
  type text not null check (type in ('Landing page','Site institucional','Funcionalidade personalizada','Ainda não sei')),
  description text not null check (char_length(description) between 10 and 3000),
  budget text check (budget is null or char_length(budget) <= 120),
  status text not null default 'Nova'
    check (status in ('Nova','Em análise','Respondida','Convertida em cliente','Arquivada')),
  internal_notes text,
  converted_client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===================================================================
-- 6. CONTRATOS E ANEXOS
-- ===================================================================
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 160),
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  service text,
  total_value numeric(12,2) not null default 0 check (total_value >= 0),
  start_date date not null,
  end_date date,
  billing_period text not null default 'Único' check (billing_period in ('Único','Mensal','Trimestral','Anual')),
  conditions text,
  maintenance_value numeric(12,2) not null default 0 check (maintenance_value >= 0),
  maintenance_start date,
  status text not null default 'Em elaboração'
    check (status in ('Em elaboração','Aguardando assinatura','Ativo','Concluído','Cancelado','Vencido')),
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_end_check check (end_date is null or end_date >= start_date),
  constraint contracts_maintenance_check check (maintenance_value = 0 or maintenance_start is not null)
);

create table if not exists public.contract_files (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

-- ===================================================================
-- 7. COBRANÇAS (RECEBÍVEIS), PAGAMENTOS E DESPESAS
-- ===================================================================
-- Cada cobrança tem um valor. Os pagamentos reduzem o saldo.
-- Mensalidades são uma cobrança por contrato e competência (AAAA-MM).
-- A restrição abaixo impede duplicidade.
create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  description text not null check (char_length(description) between 2 and 200),
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  competence text check (competence is null or competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind text not null default 'Pontual' check (kind in ('Pontual','Mensalidade')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receivables_contract_competence_key unique (contract_id, competence)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null check (method in ('Pix','Dinheiro','Transferência','Cartão','Outra')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null check (char_length(description) between 2 and 200),
  category text not null check (category in ('Ferramentas','Plataformas','Domínios','Marketing','Operacional','Outros')),
  amount numeric(12,2) not null check (amount > 0),
  spent_on date not null default current_date,
  payment_method text check (payment_method is null or payment_method in ('Pix','Dinheiro','Transferência','Cartão','Outra')),
  recurrence text not null default 'Nenhuma' check (recurrence in ('Nenhuma','Mensal','Anual')),
  receipt_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===================================================================
-- 8. PORTFÓLIO E CONFIGURAÇÕES PÚBLICAS
-- ===================================================================
create table if not exists public.portfolio (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  category text,
  description text,
  image_url text,
  link text check (link is null or link ~ '^https://'),
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value text
);

-- ===================================================================
-- 9. HISTÓRICO DE ALTERAÇÕES
-- ===================================================================
create table if not exists public.activity_log (
  id bigserial primary key,
  table_name text not null,
  record_id uuid,
  action text not null,
  label text,
  created_at timestamptz not null default now()
);

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := to_jsonb(coalesce(new, old));
  insert into public.activity_log (table_name, record_id, action, label)
  values (
    tg_table_name,
    (v ->> 'id')::uuid,
    lower(tg_op),
    left(coalesce(v ->> 'name', v ->> 'title', v ->> 'description', v ->> 'file_name', ''), 200)
  );
  return coalesce(new, old);
end;
$$;

-- ===================================================================
-- 10. REGRAS DE NEGÓCIO NO BANCO
-- ===================================================================

-- Impede que um pagamento ultrapasse o saldo restante da cobrança.
create or replace function public.check_payment_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total numeric;
  already numeric;
begin
  select amount into total from public.receivables where id = new.receivable_id;
  select coalesce(sum(amount), 0) into already
    from public.payments
    where receivable_id = new.receivable_id and id <> new.id;
  if already + new.amount > total then
    raise exception 'O pagamento ultrapassa o saldo restante desta cobrança.';
  end if;
  return new;
end;
$$;

-- Converte uma solicitação do site em cliente e, opcionalmente, em item da fila ou projeto.
-- Reaproveita o cliente se já existir o mesmo e-mail. Tudo acontece em uma única transação.
create or replace function public.convert_message(p_message uuid, p_destination text default 'Nenhum')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  cid uuid;
  pid uuid;
  next_priority integer;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão para esta ação.';
  end if;
  if p_destination not in ('Nenhum','Fila de espera','Projeto') then
    raise exception 'Destino inválido.';
  end if;

  select * into m from public.messages where id = p_message for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if m.converted_client_id is not null then
    raise exception 'Esta solicitação já foi convertida em cliente.';
  end if;

  select id into cid from public.clients
    where lower(email) = lower(m.email) and email is not null and email <> ''
    limit 1;

  if cid is null then
    insert into public.clients (name, company, email, phone, notes)
    values (
      m.name, m.company, m.email, m.phone,
      'Origem: solicitação do site em ' || to_char(m.created_at, 'DD/MM/YYYY')
    )
    returning id into cid;
  end if;

  if p_destination = 'Fila de espera' then
    select coalesce(max(priority), 0) + 1 into next_priority from public.waitlist where state = 'Na fila';
    insert into public.waitlist (client_id, service, description, entry_date, priority, state)
    values (cid, m.type, m.description, current_date, next_priority, 'Na fila');
  elsif p_destination = 'Projeto' then
    insert into public.projects (name, client_id, service, description, status)
    values (m.company || ' · ' || m.type, cid, m.type, m.description, 'Aguardando início')
    returning id into pid;
  end if;

  update public.messages
    set status = 'Convertida em cliente', converted_client_id = cid
    where id = m.id;

  return cid;
end;
$$;

-- Move um item da fila de espera para um projeto, sem duplicar.
create or replace function public.move_waitlist_to_project(p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  client_name text;
  pid uuid;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão para esta ação.';
  end if;

  select * into w from public.waitlist where id = p_item for update;
  if not found then
    raise exception 'Item da fila não encontrado.';
  end if;
  if w.state <> 'Na fila' then
    raise exception 'Este item já foi movido para um projeto.';
  end if;

  select name into client_name from public.clients where id = w.client_id;

  insert into public.projects (name, client_id, service, description, agreed_value, status)
  values (
    coalesce(w.service, 'Projeto') || ' · ' || coalesce(client_name, 'Cliente'),
    w.client_id, w.service, w.description, coalesce(w.estimated_value, 0), 'Aguardando início'
  )
  returning id into pid;

  update public.waitlist set state = 'Movido para projeto', project_id = pid where id = p_item;
  return pid;
end;
$$;

revoke execute on function public.convert_message(uuid, text) from anon;
revoke execute on function public.move_waitlist_to_project(uuid) from anon;

-- ===================================================================
-- 11. GATILHOS (atualização de data e histórico)
-- ===================================================================
drop trigger if exists clients_updated on public.clients;
create trigger clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists projects_updated on public.projects;
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists waitlist_updated on public.waitlist;
create trigger waitlist_updated before update on public.waitlist
  for each row execute function public.set_updated_at();

drop trigger if exists messages_updated on public.messages;
create trigger messages_updated before update on public.messages
  for each row execute function public.set_updated_at();

drop trigger if exists contracts_updated on public.contracts;
create trigger contracts_updated before update on public.contracts
  for each row execute function public.set_updated_at();

drop trigger if exists receivables_updated on public.receivables;
create trigger receivables_updated before update on public.receivables
  for each row execute function public.set_updated_at();

drop trigger if exists expenses_updated on public.expenses;
create trigger expenses_updated before update on public.expenses
  for each row execute function public.set_updated_at();

drop trigger if exists portfolio_updated on public.portfolio;
create trigger portfolio_updated before update on public.portfolio
  for each row execute function public.set_updated_at();

drop trigger if exists payments_limit on public.payments;
create trigger payments_limit before insert or update on public.payments
  for each row execute function public.check_payment_limit();

drop trigger if exists log_clients on public.clients;
create trigger log_clients after insert or update or delete on public.clients
  for each row execute function public.log_activity();

drop trigger if exists log_projects on public.projects;
create trigger log_projects after insert or update or delete on public.projects
  for each row execute function public.log_activity();

drop trigger if exists log_stages on public.project_stages;
create trigger log_stages after insert or update or delete on public.project_stages
  for each row execute function public.log_activity();

drop trigger if exists log_waitlist on public.waitlist;
create trigger log_waitlist after insert or update or delete on public.waitlist
  for each row execute function public.log_activity();

drop trigger if exists log_messages on public.messages;
create trigger log_messages after insert or update or delete on public.messages
  for each row execute function public.log_activity();

drop trigger if exists log_contracts on public.contracts;
create trigger log_contracts after insert or update or delete on public.contracts
  for each row execute function public.log_activity();

drop trigger if exists log_contract_files on public.contract_files;
create trigger log_contract_files after insert or update or delete on public.contract_files
  for each row execute function public.log_activity();

drop trigger if exists log_receivables on public.receivables;
create trigger log_receivables after insert or update or delete on public.receivables
  for each row execute function public.log_activity();

drop trigger if exists log_payments on public.payments;
create trigger log_payments after insert or update or delete on public.payments
  for each row execute function public.log_activity();

drop trigger if exists log_expenses on public.expenses;
create trigger log_expenses after insert or update or delete on public.expenses
  for each row execute function public.log_activity();

drop trigger if exists log_portfolio on public.portfolio;
create trigger log_portfolio after insert or update or delete on public.portfolio
  for each row execute function public.log_activity();

-- ===================================================================
-- 12. ARMAZENAMENTO DE ARQUIVOS
-- ===================================================================
insert into storage.buckets (id, name, public)
values
  ('contract-files', 'contract-files', false),
  ('expense-receipts', 'expense-receipts', false),
  ('portfolio-images', 'portfolio-images', true)
on conflict (id) do nothing;

-- ===================================================================
-- 13. REGRAS DE ACESSO (RLS)
-- ===================================================================
alter table public.admins enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.project_stages enable row level security;
alter table public.waitlist enable row level security;
alter table public.messages enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_files enable row level security;
alter table public.receivables enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.portfolio enable row level security;
alter table public.settings enable row level security;
alter table public.activity_log enable row level security;

-- Tabelas administrativas: somente administradores, em tudo.
drop policy if exists "admin total clientes" on public.clients;
create policy "admin total clientes" on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total projetos" on public.projects;
create policy "admin total projetos" on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total etapas" on public.project_stages;
create policy "admin total etapas" on public.project_stages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total fila" on public.waitlist;
create policy "admin total fila" on public.waitlist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total contratos" on public.contracts;
create policy "admin total contratos" on public.contracts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total anexos" on public.contract_files;
create policy "admin total anexos" on public.contract_files
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total cobranças" on public.receivables;
create policy "admin total cobranças" on public.receivables
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total pagamentos" on public.payments;
create policy "admin total pagamentos" on public.payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin total despesas" on public.expenses;
create policy "admin total despesas" on public.expenses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin lê histórico" on public.activity_log;
create policy "admin lê histórico" on public.activity_log
  for select to authenticated using (public.is_admin());

-- Solicitações: visitantes só ENVIAM, sempre como "Nova" e sem campos internos.
drop policy if exists "visitante envia solicitação" on public.messages;
create policy "visitante envia solicitação" on public.messages
  for insert to anon, authenticated
  with check (status = 'Nova' and internal_notes is null and converted_client_id is null);

drop policy if exists "admin lê solicitações" on public.messages;
create policy "admin lê solicitações" on public.messages
  for select to authenticated using (public.is_admin());

drop policy if exists "admin atualiza solicitações" on public.messages;
create policy "admin atualiza solicitações" on public.messages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin exclui solicitações" on public.messages;
create policy "admin exclui solicitações" on public.messages
  for delete to authenticated using (public.is_admin());

-- Portfólio: público vê apenas itens publicados.
drop policy if exists "portfólio público" on public.portfolio;
create policy "portfólio público" on public.portfolio
  for select to anon, authenticated using (published = true or public.is_admin());

drop policy if exists "admin gerencia portfólio" on public.portfolio;
create policy "admin gerencia portfólio" on public.portfolio
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Configurações institucionais: leitura pública; alteração somente administrador.
drop policy if exists "configurações públicas" on public.settings;
create policy "configurações públicas" on public.settings
  for select to anon, authenticated using (true);

drop policy if exists "admin gerencia configurações" on public.settings;
create policy "admin gerencia configurações" on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Tabela de administradores: sem políticas. Só a função is_admin() a consulta.

-- ===================================================================
-- 14. POLÍTICAS DOS ARQUIVOS
-- ===================================================================
drop policy if exists "admin lê arquivos privados" on storage.objects;
create policy "admin lê arquivos privados" on storage.objects
  for select to authenticated
  using (bucket_id in ('contract-files','expense-receipts') and public.is_admin());

drop policy if exists "admin envia arquivos privados" on storage.objects;
create policy "admin envia arquivos privados" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('contract-files','expense-receipts') and public.is_admin());

drop policy if exists "admin remove arquivos privados" on storage.objects;
create policy "admin remove arquivos privados" on storage.objects
  for delete to authenticated
  using (bucket_id in ('contract-files','expense-receipts') and public.is_admin());

drop policy if exists "portfólio lê imagens" on storage.objects;
create policy "portfólio lê imagens" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'portfolio-images');

drop policy if exists "admin envia imagens do portfólio" on storage.objects;
create policy "admin envia imagens do portfólio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'portfolio-images' and public.is_admin());

drop policy if exists "admin remove imagens do portfólio" on storage.objects;
create policy "admin remove imagens do portfólio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'portfolio-images' and public.is_admin());

-- ===================================================================
-- 15. ADMINISTRADOR INICIAL
-- ===================================================================
-- Crie também o usuário com este e-mail em Authentication > Users.
insert into public.admins (email) values ('studiomvcontato@gmail.com')
on conflict do nothing;
