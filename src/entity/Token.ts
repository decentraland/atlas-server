import { Entity, Column, PrimaryColumn, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from "typeorm"
import { Attribute } from "../modules/api/types"

@Entity()
export class Token {

    @PrimaryColumn()
    id: string

    @Column()
    name: string

    @Column()
    description: string

    @Column()
    image: string

    @Column()
    external_url: string

    @Column()
    background_color: string

    @Column({ type: "json" })
    attributes: Attribute[]

    @CreateDateColumn({ nullable: true })
    createdAt?: Date

    @UpdateDateColumn({ nullable: true })
    modifiedAt?: Date

    @DeleteDateColumn({ nullable: true })
    deletedAt?: Date
}
