"""baseline - mevcut şemanın tamamı

Revision ID: 0001
Revises:
Create Date: 2026-07-28

Bu migration, şu ana kadar elle (create_all ile) oluşturulmuş şemanın
birebir aynısını Alembic'e tanıtır.

- SIFIRDAN bir veritabanın varsa: `alembic upgrade head` çalıştır, tüm
  tabloları bu migration oluşturur.
- Zaten çalışan bir veritabanın varsa (main.py'deki create_all ile
  tablolar zaten oluşmuş durumda): tabloları TEKRAR oluşturmaya çalışıp
  hata almamak için önce `alembic stamp head` çalıştır - bu, tabloları
  dokunmadan "bu migration zaten uygulanmış" olarak işaretler. Ondan
  sonraki her yeni migration normal şekilde `alembic upgrade head` ile
  uygulanır.
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String(100), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
    )

    op.create_table(
        "characters",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("status", sa.String(30), default="aktif"),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "places",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "character_relationships",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("character_a_id", sa.Integer, sa.ForeignKey("characters.id"), nullable=False),
        sa.Column("character_b_id", sa.Integer, sa.ForeignKey("characters.id"), nullable=False),
        sa.Column("label", sa.Text, default=""),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
    )

    op.create_table(
        "events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("place_id", sa.Integer, sa.ForeignKey("places.id"), nullable=True),
        sa.Column("story_date", sa.Text, default=""),
        sa.Column("story_order", sa.Integer, nullable=True),
        sa.Column("character_ids", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "objects",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "foreshadowings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("status", sa.String(50), default="açık"),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "glossary_terms",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "rules",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "chapters",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("number", sa.Integer, nullable=False, unique=True),
        sa.Column("title", sa.Text, default=""),
        sa.Column("summary", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    op.create_table(
        "paragraphs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("chapter_id", sa.Integer, sa.ForeignKey("chapters.id"), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("is_style_sample", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
        sa.UniqueConstraint("chapter_id", "number", name="uq_chapter_paragraph"),
    )

    op.create_table(
        "paragraph_versions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("paragraph_id", sa.Integer, sa.ForeignKey("paragraphs.id"), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("saved_at", sa.DateTime),
    )

    op.create_table(
        "mentions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("paragraph_id", sa.Integer, sa.ForeignKey("paragraphs.id"), nullable=False),
        sa.Column("entity_type", sa.String(30), nullable=False),
        sa.Column("entity_id", sa.Integer, nullable=False),
        sa.Column("entity_name", sa.Text, nullable=False),
    )


def downgrade() -> None:
    for table in [
        "mentions", "paragraph_versions", "paragraphs", "chapters", "rules",
        "glossary_terms", "foreshadowings", "objects", "events",
        "character_relationships", "places", "characters", "users",
    ]:
        op.drop_table(table)
