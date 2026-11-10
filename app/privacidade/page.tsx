import LegalPage from "@/components/legal-page";
import { LEGAL, LEGAL_TERMS } from "@/lib/legal";

export const metadata = { title: "Política de privacidade — RN Integra" };

export default function PrivacyPage() {
  return <LegalPage current="/privacidade" title="Política de privacidade"
    intro={`Esta política explica como o RN Integra, fornecido por ${LEGAL.provider} (CNPJ ${LEGAL.cnpj}), trata dados pessoais, em conformidade com a Lei nº 13.709/2018 (LGPD).`}
    sections={[
      ["1. Papéis de cada um", [
        "Dados de pacientes e da agenda: a organização contratante (clínica, empresa de gestão ou médico) é a controladora; o RN Integra é o operador e só trata esses dados para prestar o serviço, conforme as instruções da organização e o Contrato de tratamento de dados.",
        "Dados de quem usa o sistema (nome, e-mail, acessos) e registros de segurança: o RN Integra é o controlador.",
      ]],
      ["2. Dados que tratamos", [
        "Usuários: nome, e-mail, papel e organizações a que pertencem, senha (guardada apenas como resultado de derivação criptográfica, nunca em texto), aceite destes documentos, registros de acesso e de alterações.",
        "Pacientes (registrados pela organização): nome, CPF, contatos, endereço, convênio e carteirinha, responsável legal no caso de recém-nascidos, agendamentos (data, procedimento, hospital, equipe), observações, histórico de atendimentos e documentos anexados (por exemplo, laudos e guias em PDF). Parte desses dados é dado pessoal sensível referente à saúde.",
        "Registros de segurança: tentativas de login, redefinição de senha, troca de organização, exportação e anonimização de pacientes. Endereços IP e e-mails nesses registros são guardados apenas de forma cifrada por hash, sem possibilidade de leitura direta.",
      ]],
      ["3. Para que usamos e com qual base legal", [
        "Prestar o serviço contratado (execução de contrato); manter a segurança, prevenir fraudes e acessos indevidos (legítimo interesse e garantia da prevenção à fraude e à segurança do titular); cumprir obrigações legais e regulatórias; atender pedidos de titulares e da ANPD.",
        "Os dados de saúde de pacientes são tratados pela organização contratante para a tutela da saúde, em procedimento realizado por profissionais de saúde ou serviços de saúde, e para o exercício regular de direitos (art. 11 da LGPD). O RN Integra não usa esses dados para finalidade própria.",
        "Não vendemos dados, não fazemos publicidade e não usamos dados de pacientes para treinar sistemas de inteligência artificial.",
      ]],
      ["4. Cookies", [
        "Usamos apenas um cookie essencial de sessão, que mantém você conectado por até 8 horas. Ele é protegido contra leitura por scripts e só trafega em conexão segura. Não usamos cookies de publicidade nem de análise de navegação.",
      ]],
      ["5. Com quem compartilhamos", [
        "Somente com fornecedores necessários para operar o serviço (suboperadores), sob contrato e obrigações de segurança: Supabase (banco de dados e arquivos, hospedados em São Paulo, Brasil); Vercel (hospedagem da aplicação, com processamento em São Paulo, Brasil, e rede de entrega global); Resend (envio de e-mails do sistema, como convites e redefinição de senha).",
        "Esses fornecedores são empresas sediadas nos Estados Unidos. Quando houver transferência internacional de dados, ela é feita com as garantias previstas no art. 33 da LGPD, como cláusulas contratuais de proteção de dados. Também podemos compartilhar dados quando exigido por lei ou por ordem de autoridade competente.",
        "Cada organização acessa somente os próprios dados; o isolamento é garantido no banco de dados.",
      ]],
      ["6. Segurança", [
        "Conexões criptografadas (HTTPS); senhas com derivação forte (PBKDF2, 600 mil iterações); sessões com expiração; isolamento por organização no banco de dados, sem acesso direto pelo navegador; permissões por papel e por agenda; registros de auditoria; limites de tentativas de acesso; cópias de segurança.",
        "Nenhum sistema é totalmente imune a falhas. Se ocorrer um incidente que possa gerar risco ou dano relevante, agiremos para contê-lo e comunicaremos os envolvidos e a ANPD nos termos da lei; para dados de pacientes, avisaremos a organização contratante em até " + LEGAL_TERMS.incidentNoticeHours + " horas após tomarmos conhecimento.",
      ]],
      ["7. Por quanto tempo guardamos", [
        "Dados de pacientes e da agenda: enquanto durar o contrato com a organização. Após o cancelamento, a organização tem " + LEGAL_TERMS.exportWindowDays + " dias para pedir a exportação; depois, os dados são eliminados de forma definitiva em até " + LEGAL_TERMS.deletionWithinDays + " dias, inclusive das cópias de segurança, salvo obrigação legal de guarda.",
        "Contas de usuários: enquanto houver vínculo ativo com alguma organização ou obrigação legal. Sessões expiradas são apagadas em 1 dia; links de convite e de redefinição de senha, 30 dias após vencerem; registros de segurança, após 1 ano.",
      ]],
      ["8. Seus direitos", [
        "Você pode pedir confirmação de tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamentos e revisão de decisões, além de revogar consentimentos quando esta for a base legal (art. 18 da LGPD).",
        "Pacientes: os pedidos devem ser feitos à clínica ou ao médico que os atende, que é o controlador. O sistema permite à organização exportar todos os dados de um paciente e anonimizá-lo; o RN Integra apoia a organização no atendimento.",
        `Usuários: faça o pedido ao encarregado pelo e-mail ${LEGAL.dpoEmail}. Responderemos em até 15 dias. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).`,
      ]],
      ["9. Encarregado pelo tratamento de dados (DPO)", [
        `Encarregado: ${LEGAL.dpoName} — ${LEGAL.dpoEmail}.`,
      ]],
      ["10. Alterações desta política", [
        "Podemos atualizar esta política. Mudanças relevantes serão comunicadas no sistema ou por e-mail. A versão vigente fica sempre nesta página.",
      ]],
    ]} />;
}
